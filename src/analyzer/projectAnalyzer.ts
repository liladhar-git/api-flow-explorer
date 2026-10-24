import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Project, ts } from 'ts-morph';
import type { AnalysisResult, AnalyzerOptions, CancellationLike, FileFacts, ScanProgress, ScanReport } from '../types/analyzer';
import type { AnalysisDiagnostic } from '../types/diagnostics';
import { CacheManager, emptyCache, type CacheData } from '../cache/cacheManager';
import { ANALYZER_VERSION } from '../cache/cacheVersion';
import { detectFrameworks } from '../scanner/frameworkDetector';
import { discoverWorkspace, type WorkspaceMeta } from '../scanner/packageDiscovery';
import { exceedsBracketDepth } from '../scanner/ignoreRules';
import { scanWorkspace } from '../scanner/workspaceScanner';
import { ALL_ADAPTERS } from './adapters';
import { GuardedFileSystem } from './guardedFileSystem';
import type { FrameworkAdapter } from './adapters/shared/adapter';
import { linkFacts } from './linker';
import { analyzeSourceFile } from './sourceFileAnalyzer';

const MAX_REPORTED_DIAGNOSTICS = 2000;

const sha = (text: string | Buffer): string => createHash('sha1').update(text).digest('hex').slice(0, 20);
const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));

export interface AnalyzeHooks {
  token?: CancellationLike;
  onProgress?: (p: ScanProgress) => void;
  adapters?: FrameworkAdapter[];
}

function createProject(root: string, meta: WorkspaceMeta, blocked: ReadonlySet<string>): Project {
  const paths: Record<string, string[]> = {};
  for (const m of meta.pathMappings) paths[m.pattern] = m.targets.map((t) => './' + t);
  const needsBase = meta.pathMappings.length > 0 || meta.compilerOptions.baseUrl !== undefined;
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    noLib: true,
    types: [],
    jsx: ts.JsxEmit.Preserve,
    resolveJsonModule: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    ...(needsBase ? { baseUrl: root, paths } : {}),
  };
  return new Project({ fileSystem: new GuardedFileSystem(blocked), skipAddingFilesFromTsConfig: true, skipLoadingLibFiles: true, compilerOptions: options });
}

async function hashConfig(root: string, configFiles: string[], options: AnalyzerOptions): Promise<string> {
  const h = createHash('sha1');
  h.update(ANALYZER_VERSION);
  h.update(JSON.stringify({ i: options.includeTests, b: options.baseUrls, d: [...options.ignoredDirectories].sort() }));
  for (const c of configFiles) {
    try {
      h.update(c).update(await fs.readFile(path.join(root, c)));
    } catch {
      h.update(c + ':missing');
    }
  }
  return h.digest('hex');
}

/**
 * Full pipeline: scan → (cache) → parse changed files → link → validate. It is independent of VS Code
 * and never executes analyzed code; it only parses files with the TypeScript compiler.
 */
export async function analyzeProject(options: AnalyzerOptions, hooks: AnalyzeHooks = {}): Promise<AnalysisResult> {
  const started = Date.now();
  const adapters = hooks.adapters ?? ALL_ADAPTERS;
  const progress = hooks.onProgress ?? (() => undefined);
  const cancelled = () => !!hooks.token?.isCancellationRequested;
  const root = path.resolve(options.root);
  const diagnostics: AnalysisDiagnostic[] = [];
  const timings = { scan: 0, hash: 0, parse: 0, link: 0, cacheLoad: 0, cacheSave: 0 };
  let mark = Date.now();
  const lap = (k: keyof typeof timings) => {
    const now = Date.now();
    timings[k] += now - mark;
    mark = now;
  };

  progress({ phase: 'discover', message: 'Scanning files…' });
  const scan = await scanWorkspace({ root, ignoredDirectories: options.ignoredDirectories, includeTests: options.includeTests, maxFiles: options.maxFiles }, hooks.token);
  const meta = await discoverWorkspace(root, scan.configFiles);
  lap('scan');
  for (const d of meta.diagnostics) diagnostics.push({ severity: 'warning', code: 'config', message: d.message, path: d.path });
  if (scan.truncated) diagnostics.push({ severity: 'warning', code: 'file-limit', message: `More than ${options.maxFiles} source files found; analysis was limited (raise apiFlowExplorer.maxFiles).` });
  for (const s of scan.skipped) if (!s.reason.startsWith('secret')) diagnostics.push({ severity: 'info', code: 'file-skipped', message: s.reason, path: s.path });

  const detection = detectFrameworks(meta);
  for (const u of detection.unsupported) {
    diagnostics.push({ severity: 'info', code: 'unsupported-framework', message: `${u.name} detected (${u.packages.join(', ')}); no adapter exists, so its routes and handlers are not analyzed.` });
  }

  // --- cache ---------------------------------------------------------------
  mark = Date.now();
  const contextHash = await hashConfig(root, scan.configFiles, options);
  const cacheMgr = options.cacheDir ? new CacheManager(options.cacheDir) : undefined;
  let cache: CacheData = emptyCache(contextHash);
  if (cacheMgr && !options.fullRescan) {
    const loaded = await cacheMgr.load(contextHash);
    cache = loaded.data;
    if (loaded.discarded) diagnostics.push({ severity: 'info', code: 'config', message: `Cache discarded: ${loaded.discarded}` });
  }
  lap('cacheLoad');

  // --- hashes --------------------------------------------------------------
  const hashes = new Map<string, string>();
  const texts = new Map<string, string>();
  /** Files never handed to the parser (served as empty by the guarded file system, even when imported). */
  const pathological = new Set<string>();
  for (const f of scan.files) {
    const cached = cache.files[f.path];
    if (cached && cached.mtimeMs === f.mtimeMs && cached.size === f.size) {
      hashes.set(f.path, cached.hash);
      continue;
    }
    try {
      const text = await fs.readFile(path.join(root, f.path), 'utf8');
      hashes.set(f.path, sha(text));
      if (exceedsBracketDepth(text)) {
        pathological.add(f.path);
        diagnostics.push({ severity: 'warning', code: 'file-skipped', message: 'file skipped: pathologically deep bracket nesting (parsing it could overflow the stack)', path: f.path });
      } else texts.set(f.path, text);
    } catch (e) {
      diagnostics.push({ severity: 'warning', code: 'file-skipped', message: `unreadable: ${(e as Error).message}`, path: f.path });
    }
    if (cancelled()) break;
  }
  const depHashCache = new Map<string, string>();
  const depHash = async (p: string): Promise<string> => {
    const known = hashes.get(p) ?? depHashCache.get(p);
    if (known) return known;
    let h = 'MISSING';
    try {
      h = sha(await fs.readFile(path.join(root, p)));
    } catch {
      /* missing */
    }
    depHashCache.set(p, h);
    return h;
  };

  const present = new Set(hashes.keys());
  const newFiles = [...present].filter((p) => !cache.files[p]);
  const removed = Object.keys(cache.files).filter((p) => !present.has(p));

  const facts = new Map<string, FileFacts>();
  const dirty: string[] = [];
  for (const p of [...present].sort()) {
    if (pathological.has(p)) continue;
    const entry = cache.files[p];
    let valid = !!entry && !options.fullRescan && entry.hash === hashes.get(p);
    if (valid && entry.facts.hasUnresolved && newFiles.length > 0) valid = false;
    if (valid) {
      for (const [dep, h] of Object.entries(entry.depHashes)) {
        if ((await depHash(dep)) !== h) {
          valid = false;
          break;
        }
      }
    }
    if (valid) facts.set(p, entry.facts);
    else dirty.push(p);
  }
  const fromCache = facts.size;
  lap('hash');

  // --- parse changed files ---------------------------------------------------
  let analyzed = 0;
  let wasCancelled = scan.cancelled || cancelled();
  if (dirty.length > 0 && !wasCancelled) {
    progress({ phase: 'parse', message: `Analyzing ${dirty.length} file(s)…`, done: 0, total: dirty.length });
    const project = createProject(root, meta, new Set([...pathological].map((p) => path.join(root, p))));
    const info = { root, options, meta };
    for (const p of [...dirty]) {
      let text = texts.get(p);
      if (text === undefined) {
        try {
          text = await fs.readFile(path.join(root, p), 'utf8');
        } catch {
          continue;
        }
      }
      try {
        project.createSourceFile(path.join(root, p), text, { overwrite: true });
      } catch (e) {
        // e.g. stack overflow inside the parser: drop this file, keep scanning
        dirty.splice(dirty.indexOf(p), 1);
        diagnostics.push({ severity: 'warning', code: 'parse-error', message: `file could not be parsed: ${(e as Error).message}`, path: p });
      }
    }
    for (const p of dirty) {
      if (cancelled()) {
        wasCancelled = true;
        break;
      }
      const sf = project.getSourceFile(path.join(root, p));
      if (!sf) continue;
      try {
        facts.set(p, analyzeSourceFile(sf, p, hashes.get(p)!, info, adapters));
      } catch (e) {
        diagnostics.push({ severity: 'warning', code: 'parse-error', message: `analysis failed: ${(e as Error).message}`, path: p });
      }
      analyzed++;
      if (analyzed % 25 === 0) {
        progress({ phase: 'parse', message: `Analyzing files (${analyzed}/${dirty.length})`, done: analyzed, total: dirty.length });
        await yieldToLoop();
      }
    }
  }

  lap('parse');
  if (wasCancelled) {
    return { graph: { schemaVersion: 1, nodes: [], edges: [] }, report: emptyReport(root, scan.files.length, started, true) };
  }

  // --- persist cache ---------------------------------------------------------
  if (cacheMgr) {
    const next = emptyCache(contextHash);
    for (const [p, f] of facts) {
      const old = cache.files[p];
      if (old && old.facts === f) {
        next.files[p] = old;
        continue;
      }
      const file = scan.files.find((x) => x.path === p);
      const depHashes: Record<string, string> = {};
      for (const d of f.deps) depHashes[d] = await depHash(d);
      next.files[p] = { mtimeMs: file?.mtimeMs ?? 0, size: file?.size ?? 0, hash: f.hash, depHashes, facts: f };
    }
    try {
      await cacheMgr.save(next);
    } catch (e) {
      diagnostics.push({ severity: 'warning', code: 'config', message: `Could not write cache: ${(e as Error).message}` });
    }
  }
  lap('cacheSave');

  // --- link ------------------------------------------------------------------
  progress({ phase: 'link', message: 'Building graph…' });
  const linked = linkFacts(facts, options, meta, adapters);
  for (const d of linked.diagnostics) diagnostics.push(d); // not push(...x): spreading huge arrays overflows the stack
  lap('link');

  const nodeCounts: Record<string, number> = {};
  for (const n of linked.graph.nodes) nodeCounts[n.kind] = (nodeCounts[n.kind] ?? 0) + 1;
  const edgeCounts: Record<string, number> = {};
  let unresolvedEdges = 0;
  for (const e of linked.graph.edges) {
    edgeCounts[e.kind] = (edgeCounts[e.kind] ?? 0) + 1;
    if (e.resolution === 'unresolved') unresolvedEdges++;
  }
  diagnostics.sort((a, b) => (a.path ?? '').localeCompare(b.path ?? '') || (a.line ?? 0) - (b.line ?? 0) || a.message.localeCompare(b.message));
  const truncatedDiagnostics = diagnostics.length > MAX_REPORTED_DIAGNOSTICS;

  const report: ScanReport = {
    root,
    filesDiscovered: scan.files.length,
    filesAnalyzed: analyzed,
    filesFromCache: fromCache,
    filesRemoved: removed.length,
    filesSkipped: scan.skipped,
    frameworks: detection.frameworks,
    packages: meta.packages.map((p) => ({ name: p.name, dir: p.dir })),
    nodeCounts,
    edgeCounts,
    unresolvedEdges,
    diagnostics: truncatedDiagnostics ? diagnostics.slice(0, MAX_REPORTED_DIAGNOSTICS) : diagnostics,
    durationMs: Date.now() - started,
    timingsMs: timings,
    cancelled: false,
  };
  progress({ phase: 'done', message: 'Done' });
  return { graph: linked.graph, report };
}

function emptyReport(root: string, discovered: number, started: number, cancelled: boolean): ScanReport {
  return {
    root, filesDiscovered: discovered, filesAnalyzed: 0, filesFromCache: 0, filesRemoved: 0, filesSkipped: [], frameworks: [], packages: [],
    nodeCounts: {}, edgeCounts: {}, unresolvedEdges: 0, diagnostics: [], durationMs: Date.now() - started, cancelled,
  };
}

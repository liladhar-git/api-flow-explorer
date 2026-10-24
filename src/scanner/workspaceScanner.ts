import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { CancellationLike } from '../types/analyzer';
import { isDeclarationFile, isSecretFile, isTestFile, makeDirFilter, SOURCE_EXTENSIONS, type IgnoreOptions } from './ignoreRules';

export interface ScannedFile {
  /** Workspace-relative POSIX path. */
  path: string;
  size: number;
  mtimeMs: number;
}

export interface ScanOutput {
  files: ScannedFile[];
  /** package.json / tsconfig.json / jsconfig.json paths (relative); never source-analyzed but used for cache invalidation. */
  configFiles: string[];
  skipped: { path: string; reason: string }[];
  truncated: boolean;
  cancelled: boolean;
}

const CONFIG_NAMES = new Set(['package.json', 'tsconfig.json', 'jsconfig.json', 'pnpm-workspace.yaml', 'lerna.json', 'next.config.js', 'next.config.mjs', 'next.config.ts']);
/** Files larger than this are almost always bundles or generated code. */
const MAX_FILE_BYTES = 1_500_000;

export interface ScanOptions extends IgnoreOptions {
  root: string;
  maxFiles: number;
}

/** Iterative directory walk using async fs; yields to the event loop and honors cancellation. Never reads file contents. */
export async function scanWorkspace(opts: ScanOptions, token?: CancellationLike): Promise<ScanOutput> {
  const isIgnoredDir = makeDirFilter(opts);
  const out: ScanOutput = { files: [], configFiles: [], skipped: [], truncated: false, cancelled: false };
  const stack: string[] = [''];

  while (stack.length) {
    if (token?.isCancellationRequested) {
      out.cancelled = true;
      break;
    }
    const rel = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(path.join(opts.root, rel), { withFileTypes: true });
    } catch (e) {
      out.skipped.push({ path: rel || '.', reason: `unreadable directory: ${(e as Error).message}` });
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue; // avoids cycles and escaping the workspace
      if (entry.isDirectory()) {
        if (!isIgnoredDir(entry.name)) stack.push(childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isSecretFile(entry.name)) {
        out.skipped.push({ path: childRel, reason: 'secret file excluded' });
        continue;
      }
      if (CONFIG_NAMES.has(entry.name)) out.configFiles.push(childRel);
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name)) || isDeclarationFile(entry.name)) continue;
      if (!opts.includeTests && isTestFile(childRel)) continue;
      let stat;
      try {
        stat = await fs.stat(path.join(opts.root, childRel));
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        out.skipped.push({ path: childRel, reason: `file too large (${stat.size} bytes)` });
        continue;
      }
      if (out.files.length >= opts.maxFiles) {
        out.truncated = true;
        continue;
      }
      out.files.push({ path: childRel, size: stat.size, mtimeMs: stat.mtimeMs });
    }
    // keep the host responsive on huge trees
    if (out.files.length % 500 === 0) await new Promise<void>((r) => setImmediate(r));
  }
  out.files.sort((a, b) => (a.path < b.path ? -1 : 1));
  out.configFiles.sort();
  return out;
}

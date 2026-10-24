import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ts } from 'ts-morph';

export interface PackageInfo {
  /** Workspace-relative directory ('' for the root). */
  dir: string;
  name: string;
  dependencies: Set<string>;
  hasNextConfig?: boolean;
}

export interface TsPathMapping {
  /** Alias pattern, e.g. "@app/*". */
  pattern: string;
  /** Targets relative to workspace root, e.g. "packages/app/src/*". */
  targets: string[];
  /** tsconfig the mapping came from. */
  source: string;
}

export interface WorkspaceMeta {
  packages: PackageInfo[];
  pathMappings: TsPathMapping[];
  compilerOptions: ts.CompilerOptions;
  diagnostics: { message: string; path: string }[];
}

function parseJson(text: string): unknown {
  const res = ts.parseConfigFileTextToJson('x.json', text);
  return res.config;
}

async function readText(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return undefined;
  }
}

/** Finds package.json/tsconfig.json files (given by the scanner), builds package info and merges path aliases. */
export async function discoverWorkspace(root: string, configFiles: string[]): Promise<WorkspaceMeta> {
  const meta: WorkspaceMeta = { packages: [], pathMappings: [], compilerOptions: {}, diagnostics: [] };

  for (const rel of configFiles) {
    const base = path.posix.basename(rel);
    const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    if (base === 'package.json') {
      const text = await readText(path.join(root, rel));
      if (text === undefined) continue;
      try {
        const json = parseJson(text) as { name?: string; dependencies?: object; devDependencies?: object; peerDependencies?: object };
        const deps = new Set<string>([
          ...Object.keys(json?.dependencies ?? {}),
          ...Object.keys(json?.devDependencies ?? {}),
          ...Object.keys(json?.peerDependencies ?? {}),
        ]);
        meta.packages.push({ dir, name: json?.name ?? (dir || path.basename(root)), dependencies: deps });
      } catch {
        meta.diagnostics.push({ message: 'package.json could not be parsed', path: rel });
      }
    }
  }

  const aliasTargets = new Map<string, Map<string, string>>(); // pattern -> target -> source
  for (const rel of configFiles.filter((c) => /(^|\/)(ts|js)config\.json$/.test(c))) {
    const abs = path.join(root, rel);
    const text = await readText(abs);
    if (text === undefined) continue;
    const parsed = ts.readConfigFile(abs, (f) => (f === abs ? text : ts.sys.readFile(f)));
    if (parsed.error) {
      meta.diagnostics.push({ message: 'tsconfig could not be parsed', path: rel });
      continue;
    }
    const cfg = ts.parseJsonConfigFileContent(parsed.config, ts.sys, path.dirname(abs), undefined, abs);
    const co = cfg.options;
    if (rel === 'tsconfig.json' || rel === 'jsconfig.json') meta.compilerOptions = { ...co };
    if (co.paths) {
      const baseDir = co.baseUrl ?? co.pathsBasePath ?? path.dirname(abs);
      for (const [pattern, targets] of Object.entries(co.paths as Record<string, string[]>)) {
        const rels = targets.map((t) => path.relative(root, path.resolve(baseDir as string, t)).split(path.sep).join('/'));
        const m = aliasTargets.get(pattern) ?? new Map<string, string>();
        for (const r of rels) if (!m.has(r)) m.set(r, rel);
        aliasTargets.set(pattern, m);
      }
    }
  }
  for (const [pattern, targets] of aliasTargets) {
    const list = [...targets.keys()];
    const sources = [...new Set(targets.values())];
    meta.pathMappings.push({ pattern, targets: list, source: sources.join(',') });
    if (sources.length > 1) {
      meta.diagnostics.push({
        message: `Path alias "${pattern}" is defined differently in ${sources.length} tsconfig files; resolution tries targets in order and may pick the wrong package`,
        path: sources[0],
      });
    }
  }
  meta.packages.sort((a, b) => (a.dir < b.dir ? -1 : 1));
  meta.pathMappings.sort((a, b) => (a.pattern < b.pattern ? -1 : 1));
  return meta;
}

/** Nearest package.json that contains a given relative file path. */
export function packageOf(meta: WorkspaceMeta, filePath: string): PackageInfo | undefined {
  let best: PackageInfo | undefined;
  for (const p of meta.packages) {
    if (p.dir === '' || filePath === p.dir || filePath.startsWith(p.dir + '/')) {
      if (!best || p.dir.length > best.dir.length) best = p;
    }
  }
  return best;
}

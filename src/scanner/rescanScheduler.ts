import * as path from 'node:path';
import { ALWAYS_IGNORED_DIRS, isSecretFile, isTestFile, SOURCE_EXTENSIONS } from './ignoreRules';

const CONFIG_FILES = new Set(['package.json', 'tsconfig.json', 'jsconfig.json', 'pnpm-workspace.yaml', 'lerna.json', 'next.config.js', 'next.config.mjs', 'next.config.ts']);

/** Should a filesystem event on this workspace-relative path trigger a re-analysis? Secrets and ignored dirs never do. */
export function isRelevantChange(relPath: string, opts: { includeTests: boolean; ignoredDirectories: string[] }): boolean {
  const segs = relPath.split('/');
  const base = segs[segs.length - 1];
  const extra = new Set(opts.ignoredDirectories);
  if (segs.slice(0, -1).some((s) => ALWAYS_IGNORED_DIRS.has(s) || extra.has(s))) return false;
  if (isSecretFile(base)) return false;
  if (CONFIG_FILES.has(base)) return true;
  if (!SOURCE_EXTENSIONS.has(path.extname(base)) || /\.d\.[cm]?ts$/.test(base)) return false;
  return opts.includeTests || !isTestFile(relPath);
}

/** Coalesces bursts of events (e.g. a branch switch) into one trailing call. */
export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly delayMs: number, private readonly fn: () => void) {}

  trigger(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.fn();
    }, this.delayMs);
  }

  get pending(): boolean {
    return this.timer !== undefined;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

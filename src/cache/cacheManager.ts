import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { FileFacts } from '../types/analyzer';
import { ANALYZER_VERSION, CACHE_FORMAT_VERSION } from './cacheVersion';

export interface CacheEntry {
  mtimeMs: number;
  size: number;
  hash: string;
  /** Hash of each dependency at the time this entry was computed ('MISSING' when absent). */
  depHashes: Record<string, string>;
  facts: FileFacts;
}

export interface CacheData {
  formatVersion: number;
  analyzerVersion: string;
  /** Hash of options + config files; any change invalidates everything. */
  contextHash: string;
  files: Record<string, CacheEntry>;
}

export function emptyCache(contextHash: string): CacheData {
  return { formatVersion: CACHE_FORMAT_VERSION, analyzerVersion: ANALYZER_VERSION, contextHash, files: {} };
}

/** Versioned JSON cache. A missing, corrupt or incompatible file is treated as an empty cache, never as an error. */
export class CacheManager {
  constructor(private readonly dir: string) {}

  private get file(): string {
    return path.join(this.dir, 'facts.json');
  }

  async load(contextHash: string): Promise<{ data: CacheData; discarded?: string }> {
    let text: string;
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch {
      return { data: emptyCache(contextHash) };
    }
    try {
      const parsed = JSON.parse(text) as Partial<CacheData>;
      if (parsed.formatVersion !== CACHE_FORMAT_VERSION || parsed.analyzerVersion !== ANALYZER_VERSION) {
        return { data: emptyCache(contextHash), discarded: 'cache version changed' };
      }
      if (parsed.contextHash !== contextHash) return { data: emptyCache(contextHash), discarded: 'configuration or options changed' };
      if (!parsed.files || typeof parsed.files !== 'object') return { data: emptyCache(contextHash), discarded: 'cache malformed' };
      return { data: parsed as CacheData };
    } catch {
      return { data: emptyCache(contextHash), discarded: 'cache corrupt' };
    }
  }

  async save(data: CacheData): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fs.rename(tmp, this.file); // atomic replace so a crash never leaves a half-written cache
  }

  async clear(): Promise<void> {
    await fs.rm(this.file, { force: true });
  }
}

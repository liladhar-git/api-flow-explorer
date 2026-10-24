import * as path from 'node:path';
import { analyzeProject } from '../../src/analyzer/projectAnalyzer';
import type { AnalysisResult, AnalyzerOptions } from '../../src/types/analyzer';
import type { Graph, GraphEdge, GraphNode } from '../../src/types/graph';

export const FIXTURES = path.resolve(__dirname, '../fixtures');

export function fixtureOptions(name: string, extra: Partial<AnalyzerOptions> = {}): AnalyzerOptions {
  return { root: path.join(FIXTURES, name), ignoredDirectories: [], includeTests: false, maxFiles: 20000, baseUrls: {}, ...extra };
}

export function analyzeFixture(name: string, extra: Partial<AnalyzerOptions> = {}): Promise<AnalysisResult> {
  return analyzeProject(fixtureOptions(name, extra));
}

export const node = (g: Graph, id: string): GraphNode | undefined => g.nodes.find((n) => n.id === id);
export const nodesOfKind = (g: Graph, kind: string): GraphNode[] => g.nodes.filter((n) => n.kind === kind);
export const edge = (g: Graph, kind: string, source: string | RegExp, target: string | RegExp): GraphEdge | undefined =>
  g.edges.find((e) => e.kind === kind && (typeof source === 'string' ? e.source === source : source.test(e.source)) && (typeof target === 'string' ? e.target === target : target.test(e.target)));

import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const TMP = path.resolve(__dirname, '../../.test-tmp');

/** Copies a fixture into a throwaway workspace (inside the repo's gitignored .test-tmp) so tests can mutate files. */
export function copyFixture(name: string): { root: string; cacheDir: string; cleanup: () => void } {
  const id = `${name}-${randomBytes(4).toString('hex')}`;
  const root = path.join(TMP, id, 'ws');
  const cacheDir = path.join(TMP, id, 'cache');
  mkdirSync(root, { recursive: true });
  cpSync(path.join(FIXTURES, name), root, { recursive: true });
  return { root, cacheDir, cleanup: () => rmSync(path.join(TMP, id), { recursive: true, force: true }) };
}

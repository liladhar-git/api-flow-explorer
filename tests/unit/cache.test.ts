import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { analyzeProject } from '../../src/analyzer/projectAnalyzer';
import type { AnalyzerOptions } from '../../src/types/analyzer';
import { copyFixture, edge, node } from './helpers';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function workspace(name: string) {
  const ws = copyFixture(name);
  cleanups.push(ws.cleanup);
  const opts = (extra: Partial<AnalyzerOptions> = {}): AnalyzerOptions => ({ root: ws.root, ignoredDirectories: [], includeTests: false, maxFiles: 20000, baseUrls: {}, cacheDir: ws.cacheDir, ...extra });
  return { ...ws, opts, file: (rel: string) => path.join(ws.root, rel) };
}

/** Incremental analysis must always equal a from-scratch analysis of the same files. */
async function expectEquivalentToFullScan(opts: AnalyzerOptions, incremental: Awaited<ReturnType<typeof analyzeProject>>) {
  const full = await analyzeProject({ ...opts, cacheDir: undefined });
  expect(incremental.graph).toEqual(full.graph);
}

describe('incremental cache', () => {
  it('reuses analysis for unchanged files', async () => {
    const w = workspace('react-express');
    const first = await analyzeProject(w.opts());
    expect(first.report.filesFromCache).toBe(0);
    expect(first.report.filesAnalyzed).toBe(first.report.filesDiscovered);
    const second = await analyzeProject(w.opts());
    expect(second.report.filesAnalyzed).toBe(0);
    expect(second.report.filesFromCache).toBe(first.report.filesDiscovered);
    expect(second.graph).toEqual(first.graph);
  });

  it('reanalyzes a changed file and its dependents only, with the same result as a full scan', async () => {
    const w = workspace('react-express');
    const first = await analyzeProject(w.opts());
    const f = w.file('server/services/userService.ts');
    writeFileSync(f, readFileSync(f, 'utf8').replace('export async function findAll()', 'export async function findEveryone()'));
    const next = await analyzeProject(w.opts());
    expect(next.report.filesAnalyzed).toBeGreaterThanOrEqual(2); // the file + files that resolved symbols through it
    expect(next.report.filesAnalyzed).toBeLessThan(first.report.filesDiscovered);
    // stale facts are gone: the renamed function no longer has the old call edge
    expect(node(next.graph, 'sym:server/services/userService.ts#findAll')).toBeUndefined();
    expect(edge(next.graph, 'calls', 'sym:server/controllers/userController.ts#listUsers', 'sym:server/services/userService.ts#findAll')).toBeUndefined();
    expect(node(next.graph, 'sym:server/services/userService.ts#findEveryone')).toBeDefined();
    await expectEquivalentToFullScan(w.opts(), next);
  });

  it('invalidates dependents when an imported constant changes (route declarations across files)', async () => {
    const w = workspace('monorepo');
    const a = await analyzeProject(w.opts());
    expect(a.graph.nodes.some((n) => n.kind === 'api-endpoint' && n.metadata.path === '/api/users')).toBe(true);
    const f = w.file('packages/shared/src/endpoints.ts');
    writeFileSync(f, readFileSync(f, 'utf8').replace("'/api'", "'/v2'"));
    const b = await analyzeProject(w.opts());
    expect(b.report.filesFromCache).toBeGreaterThan(0);
    const paths = b.graph.nodes.filter((n) => n.kind === 'api-endpoint').map((n) => n.metadata.path);
    expect(paths).toEqual(['/v2/users']); // server.ts was reanalyzed because its constant changed
    expect(b.graph.edges.some((e) => e.kind === 'http-request' && e.resolution === 'resolved')).toBe(true); // web request follows too
    await expectEquivalentToFullScan(w.opts(), b);
  });

  it('removes nodes and edges of deleted files', async () => {
    const w = workspace('react-express');
    await analyzeProject(w.opts());
    unlinkSync(w.file('server/routes/orders.ts'));
    const next = await analyzeProject(w.opts());
    expect(next.report.filesRemoved).toBe(1);
    expect(next.graph.nodes.some((n) => n.kind === 'api-endpoint' && String(n.metadata.path).startsWith('/api/orders'))).toBe(false);
    expect(next.graph.nodes.some((n) => n.path === 'server/routes/orders.ts')).toBe(false);
    expect(JSON.stringify(next.graph)).not.toContain('routes/orders.ts');
    await expectEquivalentToFullScan(w.opts(), next);
  });

  it('picks up a newly added file that fixes a previously unresolved import', async () => {
    const w = workspace('edge-cases');
    const first = await analyzeProject(w.opts());
    expect(first.report.diagnostics.some((d) => d.code === 'unresolved-import')).toBe(true);
    writeFileSync(w.file('src/does-not-exist.ts'), "import express from 'express';\nexport default express.Router();\n");
    const next = await analyzeProject(w.opts());
    expect(next.report.diagnostics.some((d) => d.code === 'unresolved-import')).toBe(false);
    await expectEquivalentToFullScan(w.opts(), next);
  });

  it('invalidates everything when configuration or options change', async () => {
    const w = workspace('nextjs');
    const first = await analyzeProject(w.opts());
    const tsconfig = w.file('tsconfig.json');
    writeFileSync(tsconfig, readFileSync(tsconfig, 'utf8').replace('"@/*"', '"@@/*"'));
    const afterConfig = await analyzeProject(w.opts());
    expect(afterConfig.report.filesFromCache).toBe(0);
    expect(afterConfig.report.filesAnalyzed).toBe(first.report.filesDiscovered);
    const afterOptions = await analyzeProject(w.opts({ baseUrls: { NEXT_PUBLIC_API_URL: 'https://x.test' } }));
    expect(afterOptions.report.filesFromCache).toBe(0);
  });

  it('supports a forced full rescan', async () => {
    const w = workspace('express-edge');
    await analyzeProject(w.opts());
    const forced = await analyzeProject(w.opts({ fullRescan: true }));
    expect(forced.report.filesFromCache).toBe(0);
    expect(forced.report.filesAnalyzed).toBe(forced.report.filesDiscovered);
    const after = await analyzeProject(w.opts());
    expect(after.report.filesAnalyzed).toBe(0); // forced rescan refreshed the cache
  });

  it('recovers from a corrupt, truncated or incompatible cache', async () => {
    const w = workspace('express-edge');
    const first = await analyzeProject(w.opts());
    const file = path.join(w.cacheDir, 'facts.json');
    const good = readFileSync(file, 'utf8');
    for (const bad of ['{ not json', good.slice(0, good.length / 2), JSON.stringify({ formatVersion: 999, files: {} }), JSON.stringify({ ...JSON.parse(good), analyzerVersion: 'old' }), '[]', 'null']) {
      writeFileSync(file, bad);
      const r = await analyzeProject(w.opts());
      expect(r.graph).toEqual(first.graph);
      expect(r.report.filesAnalyzed).toBe(r.report.filesDiscovered);
    }
    rmSync(w.cacheDir, { recursive: true });
    expect((await analyzeProject(w.opts())).graph).toEqual(first.graph);
  });

  it('never stores secrets or credentials in the cache', async () => {
    const w = workspace('react-express');
    writeFileSync(w.file('client/src/api/leaky.ts'), "export const x = () => fetch('https://user:hunter3@api.example.com/v1/items?api_key=SUPERSECRET&page=2');\n");
    const r = await analyzeProject(w.opts());
    const cache = readFileSync(path.join(w.cacheDir, 'facts.json'), 'utf8');
    const graph = JSON.stringify(r.graph);
    for (const text of [cache, graph]) {
      for (const secret of ['super-secret-value', 'hunter2', 'hunter3', 'SUPERSECRET']) expect(text).not.toContain(secret);
    }
    expect(graph).toContain('api.example.com');
  });
});

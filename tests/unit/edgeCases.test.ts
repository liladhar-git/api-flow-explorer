import { describe, expect, it } from 'vitest';
import { analyzeFixture, nodesOfKind } from './helpers';
import { scanWorkspace } from '../../src/scanner/workspaceScanner';
import { isSecretFile, isTestFile } from '../../src/scanner/ignoreRules';
import { validateGraph } from '../../src/graph/graphValidator';
import { FIXTURES } from './helpers';
import * as path from 'node:path';

describe('scanner rules', () => {
  it('classifies secret and test files', () => {
    for (const f of ['.env', '.env.local', '.env.production', 'id_rsa', 'server.pem', 'tls.key', 'credentials.json', '.npmrc']) expect(isSecretFile(f)).toBe(true);
    for (const f of ['app.ts', 'environment.ts', 'keyboard.ts']) expect(isSecretFile(f)).toBe(false);
    expect(isTestFile('src/a.test.ts')).toBe(true);
    expect(isTestFile('src/__tests__/a.ts')).toBe(true);
    expect(isTestFile('src/contest/a.ts')).toBe(false);
  });

  it('scan honours ignored directories, secrets, symlink safety and cancellation', async () => {
    const root = path.join(FIXTURES, 'edge-cases');
    const out = await scanWorkspace({ root, ignoredDirectories: [], includeTests: false, maxFiles: 100 });
    const paths = out.files.map((f) => f.path);
    expect(paths).toEqual(['src/app.ts', 'src/other.ts']);
    expect(out.skipped.filter((s) => s.reason.startsWith('secret')).map((s) => s.path).sort()).toEqual(['config/.env.local', 'secrets/private.pem', 'src/credentials.ts']);
    const withTests = await scanWorkspace({ root, ignoredDirectories: [], includeTests: true, maxFiles: 100 });
    expect(withTests.files.map((f) => f.path)).toContain('src/app.test.ts');
    const limited = await scanWorkspace({ root, ignoredDirectories: ['src'], includeTests: false, maxFiles: 100 });
    expect(limited.files).toEqual([]);
    const capped = await scanWorkspace({ root, ignoredDirectories: [], includeTests: true, maxFiles: 1 });
    expect(capped.truncated).toBe(true);
    const cancelled = await scanWorkspace({ root, ignoredDirectories: [], includeTests: false, maxFiles: 100 }, { isCancellationRequested: true });
    expect(cancelled.cancelled).toBe(true);
  });
});

describe('static analysis false positives and diagnostics', async () => {
  const { graph, report } = await analyzeFixture('edge-cases');
  const endpoints = nodesOfKind(graph, 'api-endpoint').map((n) => n.metadata.path);

  it('ignores routes in comments, strings, tests, build output and secret files', () => {
    expect(endpoints).toEqual(['/real']);
    const dump = JSON.stringify(graph) + JSON.stringify(report);
    for (const bad of ['commented', 'in-string', 'block-comment', 'only-in-tests', 'from-env-file', 'sk_live', 'PRIVATE KEY', 'compiled', 'nextOut']) expect(dump).not.toContain(bad);
  });

  it('includes tests only when asked', async () => {
    const withTests = await analyzeFixture('edge-cases', { includeTests: true });
    expect(nodesOfKind(withTests.graph, 'api-endpoint').map((n) => n.metadata.path).sort()).toEqual(['/only-in-tests', '/real']);
  });

  it('reports unresolved imports, aliases and dynamic imports instead of guessing', () => {
    const codes = report.diagnostics.filter((d) => d.path === 'src/app.ts').map((d) => `${d.code}@${d.line}`);
    expect(codes).toContain('unresolved-import@2');
    expect(codes).toContain('unresolved-alias@3');
    expect(codes.some((c) => c.startsWith('dynamic-import@'))).toBe(true);
    expect(report.diagnostics.some((d) => d.code === 'dynamic-import' && d.severity === 'info' && /literal/.test(d.message))).toBe(true);
  });

  it('does not invent a mount for an unresolved router import', () => {
    expect(graph.edges.some((e) => e.kind === 'mounts-router' && e.resolution === 'resolved')).toBe(false);
    expect(report.diagnostics.some((d) => d.code === 'unresolved-mount')).toBe(true);
  });

  it('produces a valid, path-safe graph', () => {
    expect(validateGraph(graph).ok).toBe(true);
  });
});

describe('graph validation', () => {
  const node = (id: string) => ({ id, kind: 'function', name: id, metadata: {} });
  const edge = (id: string, source: string, target: string) => ({ id, source, target, kind: 'calls', evidence: { path: 'a.ts', line: 1, explanation: 'x' }, confidence: 'high', resolution: 'resolved' });

  it('accepts a consistent graph', () => {
    expect(validateGraph({ schemaVersion: 1, nodes: [node('a'), node('b')], edges: [edge('e', 'a', 'b')] }).ok).toBe(true);
  });
  it('rejects dangling edge endpoints', () => {
    const r = validateGraph({ schemaVersion: 1, nodes: [node('a')], edges: [edge('e', 'a', 'ghost')] });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('dangling target ghost');
  });
  it('rejects duplicate node and edge ids', () => {
    const r = validateGraph({ schemaVersion: 1, nodes: [node('a'), node('a')], edges: [edge('e', 'a', 'a'), edge('e', 'a', 'a')] });
    expect(r.errors.join()).toContain('duplicate node id: a');
    expect(r.errors.join()).toContain('duplicate edge id: e');
  });
  it('rejects absolute paths, unknown kinds and bad lines', () => {
    expect(validateGraph({ schemaVersion: 1, nodes: [{ ...node('a'), path: '/etc/passwd' }], edges: [] }).ok).toBe(false);
    expect(validateGraph({ schemaVersion: 1, nodes: [{ ...node('a'), path: '../x.ts' }], edges: [] }).ok).toBe(false);
    expect(validateGraph({ schemaVersion: 1, nodes: [{ ...node('a'), kind: 'banana' }], edges: [] }).ok).toBe(false);
    expect(validateGraph({ schemaVersion: 1, nodes: [{ ...node('a'), startLine: 0 }], edges: [] }).ok).toBe(false);
    expect(validateGraph({ schemaVersion: 1, nodes: [node('a')], edges: [{ ...edge('e', 'a', 'a'), confidence: 'certain' }] }).ok).toBe(false);
  });
});

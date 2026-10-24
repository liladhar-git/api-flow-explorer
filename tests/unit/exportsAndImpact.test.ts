import { describe, expect, it } from 'vitest';
import { analyzeFixture, nodesOfKind } from './helpers';
import { exportJson } from '../../src/export/exportJson';
import { exportMermaid } from '../../src/export/exportMermaid';
import { exportMarkdown } from '../../src/export/exportMarkdown';
import { focusView, GraphIndex, nodeAtPosition, referencesTo } from '../../src/graph/graphQueries';
import { analyzeImpact, formatImpact } from '../../src/graph/impactAnalyzer';
import { GraphSchema } from '../../src/types/graph';
import { Debouncer, isRelevantChange } from '../../src/scanner/rescanScheduler';
import { vi } from 'vitest';

describe('exports', async () => {
  const { graph } = await analyzeFixture('react-express');
  const index = new GraphIndex(graph);
  const ep = nodesOfKind(graph, 'api-endpoint').find((e) => e.metadata.path === '/api/users' && e.metadata.method === 'GET')!;

  it('JSON export is the complete, valid, deterministic graph without source text', async () => {
    const json = exportJson(graph);
    expect(GraphSchema.parse(JSON.parse(json))).toEqual(graph);
    expect(exportJson((await analyzeFixture('react-express')).graph)).toBe(json);
    expect(json).not.toContain('super-secret');
    expect(json).not.toContain('export async function findAll'); // no source contents
    expect(json).not.toContain('/home/');
  });

  it('Mermaid export covers a flow with shapes, evidence paths, confidence and unresolved styling', () => {
    const ids = focusView(index, ep.id, 4)!.nodes.map((n) => n.id);
    const m = exportMermaid(graph, ids);
    expect(m.startsWith('flowchart LR\n')).toBe(true);
    expect(m).toContain('{{"GET /api/users<br/>server/routes/users.ts:8"}}'); // hexagon for endpoints
    expect(m).toContain('[("User<br/>server/models/User.ts:4")]'); // cylinder shape for the data store, located at its declaration
    expect(m).toContain('server/services/userService.ts:3');
    expect(m).toContain('handles-route');
    expect(exportMermaid(graph, ids)).toBe(m); // deterministic
    const unresolved = graph.edges.find((e) => e.resolution === 'unresolved')!;
    const withUnresolved = exportMermaid(graph, [unresolved.source, unresolved.target]);
    expect(withUnresolved).toMatch(/-\.->\|"http-request · low unresolved"\|/);
    expect(withUnresolved).toContain('linkStyle 0 stroke:#f14c4c');
    // injection-safe labels
    const nasty = exportMermaid({ schemaVersion: 1, nodes: [{ id: 'x', kind: 'function', name: 'a"b<script>\nline', metadata: {} }], edges: [] }, ['x']);
    expect(nasty).not.toContain('<script>');
    expect(nasty.split('\n').filter((l) => l.includes('line')).length).toBe(1);
  });

  it('Markdown export documents endpoints, handlers, middleware, data access and callers with confidence', () => {
    const md = exportMarkdown(graph);
    expect(md).toContain('### PUT `/api/users/:id/avatar`');
    expect(md).toContain('| GET | `/api/users` | express | `server/routes/users.ts:8` |');
    expect(md).toContain('requireAuth');
    expect(md).toMatch(/reads User — server\/services\/userService\.ts:\d+ \(high\)/);
    expect(md).toMatch(/Called from[\s\S]*GET \/api\/users[\s\S]*\(high\)/);
    expect(md).toContain('## Requests without a matching endpoint');
    expect(md).toContain('no endpoint matches GET /api/does-not-exist');
    expect(exportMarkdown(graph)).toBe(md);
    expect(md).not.toContain('super-secret');
  });
});

describe('impact analysis and references', async () => {
  const { graph } = await analyzeFixture('react-express');
  const index = new GraphIndex(graph);

  it('finds the endpoints, requests and UI affected by changing a service function', () => {
    const r = analyzeImpact(index, 'sym:server/services/userService.ts#findAll')!;
    expect(r.endpoints.map((i) => i.node.id)).toEqual([expect.stringContaining('GET /api/users@server/routes/users.ts')]);
    expect(r.requests.length).toBeGreaterThan(0);
    expect(r.frontend.map((i) => i.node.name)).toEqual(expect.arrayContaining(['UserList']));
    expect(r.dependents.map((i) => i.node.name)).toContain('listUsers');
    expect(r.dependencies.map((d) => d.name)).toContain('User');
    const ep = r.endpoints[0];
    expect(ep.path.nodes[0]).toBe(ep.node.id);
    expect(ep.path.nodes.at(-1)).toBe('sym:server/services/userService.ts#findAll');
    expect(ep.path.confidence).toBe('high');
    expect(ep.path.certain).toBe(true);
  });

  it('does not report unrelated endpoints as affected (negative)', () => {
    const r = analyzeImpact(index, 'sym:server/services/userService.ts#findAll')!;
    expect(r.endpoints.some((e) => /orders|health/.test(e.node.id))).toBe(false);
    expect(r.dependents.some((d) => /orderController/.test(d.node.id))).toBe(false);
  });

  it('impact of a model reaches every reader and writer and the endpoints behind them', () => {
    const r = analyzeImpact(index, 'model:User')!;
    expect(r.dependents.map((d) => d.node.name)).toEqual(expect.arrayContaining(['findAll', 'findById', 'create', 'setAvatar']));
    expect(r.endpoints.map((e) => e.node.name).sort()).toEqual(expect.arrayContaining(['GET /api/users', 'GET /api/users/:id', 'POST /api/users']));
  });

  it('marks paths through inferred edges as not certain and honours a minimum confidence', () => {
    const e = nodesOfKind(graph, 'api-endpoint').find((n) => n.metadata.path === '/api/users/:id' && n.metadata.method === 'GET')!;
    const r = analyzeImpact(index, e.id)!;
    const req = r.requests.find((i) => /api\/users\.ts:4/.test(i.node.id))!;
    expect(req.path.certain).toBe(false);
    expect(req.path.confidence).toBe('medium');
    const strict = analyzeImpact(index, e.id, { minConfidence: 'high' })!;
    expect(strict.requests.some((i) => /api\/users\.ts:4/.test(i.node.id))).toBe(false);
    expect(formatImpact(r)).toContain('Static analysis');
  });

  it('handles cycles and unknown ids', () => {
    expect(analyzeImpact(index, 'nope')).toBeUndefined();
    const cyc = new GraphIndex({
      schemaVersion: 1,
      nodes: ['a', 'b'].map((id) => ({ id, kind: 'function' as const, name: id, metadata: {} })),
      edges: [['a', 'b'], ['b', 'a']].map(([s, t]) => ({ id: s + t, source: s, target: t, kind: 'calls' as const, evidence: { path: 'x.ts', line: 1, explanation: 'x' }, confidence: 'high' as const, resolution: 'resolved' as const })),
    });
    expect(analyzeImpact(cyc, 'a')!.dependents.map((d) => d.node.id)).toEqual(['b']);
  });

  it('maps cursor positions to the innermost symbol and lists references with evidence', () => {
    expect(nodeAtPosition(index, 'server/services/userService.ts', 4)!.id).toBe('sym:server/services/userService.ts#findAll');
    expect(nodeAtPosition(index, 'server/services/userService.ts', 1)).toBeUndefined();
    const refs = referencesTo(index, 'sym:server/services/userService.ts#findAll');
    expect(refs.map((r) => r.from.name)).toContain('listUsers');
    expect(refs[0].edge.evidence).toMatchObject({ path: 'server/controllers/userController.ts', line: 5 });
  });
});

describe('rescan scheduling', () => {
  const opts = { includeTests: false, ignoredDirectories: ['generated'] };
  it('reacts to source and config files only', () => {
    for (const p of ['src/a.ts', 'src/a.tsx', 'a.js', 'packages/x/package.json', 'tsconfig.json']) expect(isRelevantChange(p, opts)).toBe(true);
    for (const p of ['README.md', 'node_modules/x/index.js', 'dist/a.js', '.git/HEAD', '.env', 'config/.env.local', 'src/a.d.ts', 'src/a.test.ts', 'generated/a.ts', 'img/logo.png', 'secrets/key.pem']) expect(isRelevantChange(p, opts)).toBe(false);
    expect(isRelevantChange('src/a.test.ts', { ...opts, includeTests: true })).toBe(true);
  });

  it('debounces bursts into a single trailing call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = new Debouncer(500, fn);
    for (let i = 0; i < 20; i++) {
      d.trigger();
      vi.advanceTimersByTime(100);
    }
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    d.trigger();
    d.dispose();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

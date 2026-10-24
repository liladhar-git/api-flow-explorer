import { describe, expect, it } from 'vitest';
import { analyzeFixture, edge, node } from './helpers';
import { validateGraph } from '../../src/graph/graphValidator';

describe('scan and symbol graph (react-express fixture)', async () => {
  const { graph, report } = await analyzeFixture('react-express');

  it('discovers source files and skips ignored dirs and secrets', () => {
    expect(report.filesDiscovered).toBeGreaterThan(15);
    const text = JSON.stringify(graph) + JSON.stringify(report.diagnostics);
    expect(text).not.toContain('node_modules');
    expect(text).not.toContain('dist/bundle');
    expect(text).not.toContain('super-secret-value');
    expect(text).not.toContain('hunter2');
    expect(report.filesSkipped.some((s) => s.path === '.env' && s.reason.startsWith('secret'))).toBe(true);
  });

  it('produces a valid graph with workspace-relative paths only', () => {
    expect(validateGraph(graph).ok).toBe(true);
    for (const n of graph.nodes) if (n.path) expect(n.path.startsWith('/')).toBe(false);
    expect(JSON.stringify(graph)).not.toContain('/home/');
  });

  it('assigns stable, deterministic ids', async () => {
    const again = await analyzeFixture('react-express');
    expect(again.graph).toEqual(graph);
    expect(node(graph, 'sym:server/services/userService.ts#findAll')).toBeDefined();
  });

  it('resolves cross-file calls through namespace imports and path aliases', () => {
    const e = edge(graph, 'calls', 'sym:server/controllers/userController.ts#listUsers', 'sym:server/services/userService.ts#findAll');
    expect(e).toMatchObject({ confidence: 'high', resolution: 'resolved' });
    expect(e!.evidence).toMatchObject({ path: 'server/controllers/userController.ts', line: 5 });
    // alias import "@client/api/users"
    expect(edge(graph, 'calls', 'sym:client/src/hooks/useUsers.ts#useUsers', 'sym:client/src/api/users.ts#fetchUsers')).toBeDefined();
  });

  it('resolves calls to wrapped handlers and object-literal methods', () => {
    expect(node(graph, 'sym:server/controllers/userController.ts#createUser')).toBeDefined();
    expect(edge(graph, 'calls', 'sym:server/controllers/userController.ts#createUser', 'sym:server/services/userService.ts#create')).toBeDefined();
    expect(edge(graph, 'calls', 'sym:server/controllers/orderController.ts#orderController.list', /./)).toBeUndefined(); // Order.find is a model call, not a workspace function
  });

  it('does not link by name similarity', () => {
    expect(edge(graph, 'calls', 'sym:server/services/userService.ts#findAll', /orderController/)).toBeUndefined();
  });

  it('reports malformed files as diagnostics without crashing', () => {
    expect(report.diagnostics.some((d) => d.code === 'parse-error' && d.path === 'server/broken.ts')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { analyzeFixture, edge, nodesOfKind } from './helpers';

describe('re-exports and shared models', async () => {
  const { graph } = await analyzeFixture('reexports');

  it('resolves calls through barrel files (`export *`, `export { x } from`)', () => {
    expect(edge(graph, 'calls', 'sym:src/consumer.ts#report', 'sym:src/util/format.ts#fmt')).toMatchObject({ confidence: 'high', resolution: 'resolved' });
    expect(edge(graph, 'calls', 'sym:src/consumer.ts#report', 'sym:src/services/a.ts#listA')).toBeDefined();
  });

  it('traces models imported through a barrel, by named import and by namespace', () => {
    expect(edge(graph, 'reads', 'sym:src/services/a.ts#listA', 'model:User')).toBeDefined(); // export { User } from './user'
    expect(edge(graph, 'writes', 'sym:src/services/b.ts#saveOrder', 'model:Order')).toBeDefined(); // models.Order via export *
    expect(edge(graph, 'reads', 'sym:src/services/b.ts#countB', 'model:User')).toBeDefined(); // namespace import
  });

  it('one shared model node is read and written by several services, located at its declaration', () => {
    const users = nodesOfKind(graph, 'model').filter((n) => n.name === 'User');
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ path: 'src/models/user.ts', startLine: 3 });
    const touching = graph.edges.filter((e) => e.target === 'model:User').map((e) => `${e.kind}:${e.source}`).sort();
    expect(touching).toEqual([
      'reads:sym:src/services/a.ts#listA',
      'reads:sym:src/services/b.ts#countB',
      'writes:sym:src/services/a.ts#saveA',
    ]);
  });

  it('does not attribute one service\'s model access to another (negative)', () => {
    expect(edge(graph, 'writes', 'sym:src/services/b.ts#countB', 'model:User')).toBeUndefined();
    expect(edge(graph, 'reads', 'sym:src/services/a.ts#saveA', 'model:User')).toBeUndefined();
    expect(edge(graph, 'reads', /services\/a\.ts/, 'model:Order')).toBeUndefined();
  });
});

describe('layer tagging', async () => {
  const { analyzeFixture: run } = await import('./helpers');
  it('marks plain functions in React/JSX files as frontend and server code as backend', async () => {
    const { graph } = await run('react-express');
    const layer = (id: string) => graph.nodes.find((n) => n.id === id)?.metadata.layer;
    expect(layer('sym:client/src/api/http.ts#getJson')).toBeUndefined(); // plain .ts without React: not tagged
    expect(layer('sym:client/src/hooks/useUsers.ts#useUsers')).toBe('frontend'); // imports react
    expect(layer('sym:server/services/userService.ts#findAll')).toBeUndefined();
    const next = await run('nextjs');
    expect(next.graph.nodes.find((n) => n.id === 'sym:src/app/api/products/route.ts#GET')?.metadata.layer).toBeUndefined();
    expect(next.graph.nodes.find((n) => n.id === 'sym:src/pages/users/index.tsx#getServerSideProps')?.metadata.layer).toBeUndefined();
  });
});

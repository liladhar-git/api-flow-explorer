import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { analyzeFixture, FIXTURES, nodesOfKind } from './helpers';
import { expandView, focusView, GraphIndex, listEndpoints, searchEndpoints } from '../../src/graph/graphQueries';
import { traverse } from '../../src/graph/graphTraversal';
import { locationOfEdge, locationOfNode } from '../../src/graph/sourceLocation';

describe('graph views and navigation', async () => {
  const { graph } = await analyzeFixture('react-express');
  const index = new GraphIndex(graph);
  const endpoints = listEndpoints(graph);
  const ep = (m: string, p: string) => endpoints.find((e) => e.method === m && e.path === p)!;

  it('lists endpoints sorted and filterable', () => {
    expect(endpoints).toHaveLength(7);
    expect(searchEndpoints(endpoints, { query: 'avatar' }).map((e) => e.path)).toEqual(['/api/users/:id/avatar']);
    // several terms must all match, in any order, across method/path/framework/file
    expect(searchEndpoints(endpoints, { query: 'post users' }).map((e) => `${e.method} ${e.path}`)).toEqual(['POST /api/users']);
    expect(searchEndpoints(endpoints, { query: 'ORDERS delete' }).map((e) => e.path)).toEqual(['/api/orders/:orderId']);
    expect(searchEndpoints(endpoints, { query: 'routes/users.ts get' })).toHaveLength(2);
    expect(searchEndpoints(endpoints, { query: 'post orders' })).toEqual([]);
    expect(searchEndpoints(endpoints, { query: '   ' })).toHaveLength(endpoints.length);
    expect(searchEndpoints(endpoints, { methods: ['DELETE'] })).toHaveLength(1);
    expect(searchEndpoints(endpoints, { frameworks: ['nestjs'] })).toHaveLength(0);
  });

  it('builds an endpoint-centric view: requests upstream, handler/service/data downstream', () => {
    const e = ep('GET', '/api/users');
    const view = focusView(index, e.id, 4)!;
    const ids = new Set(view.nodes.map((n) => n.id));
    expect(ids.has('sym:server/controllers/userController.ts#listUsers')).toBe(true);
    expect(ids.has('sym:server/services/userService.ts#findAll')).toBe(true);
    expect(ids.has('model:User')).toBe(true);
    expect([...ids].some((i) => i.startsWith('request:client/src/api/users.ts:3'))).toBe(true);
    expect(ids.has('sym:client/src/hooks/useUsers.ts#useUsers')).toBe(true); // up through request owner
    expect(ids.has('sym:client/src/components/UserList.tsx#UserList')).toBe(true);
    // not the whole repository
    expect(view.nodes.length).toBeLessThan(graph.nodes.length);
    expect(ids.has('model:Order')).toBe(false);
  });

  it('reports hidden relationships so nodes can be expanded, then grows the view', () => {
    const view = focusView(index, ep('GET', '/api/users').id, 1)!;
    const handler = 'sym:server/controllers/userController.ts#listUsers';
    expect(view.hidden[handler]?.down).toBeGreaterThan(0);
    const grown = expandView(index, new Set(view.nodes.map((n) => n.id)), handler, 'downstream', 1);
    expect(grown.nodes.length).toBeGreaterThan(view.nodes.length);
    expect(grown.nodes.some((n) => n.id === 'sym:server/services/userService.ts#findAll')).toBe(true);
  });

  it('traversal terminates on cycles and honours depth and maxNodes', () => {
    const cyc = new GraphIndex({
      schemaVersion: 1,
      nodes: ['a', 'b', 'c'].map((id) => ({ id, kind: 'function' as const, name: id, metadata: {} })),
      edges: [['a', 'b'], ['b', 'c'], ['c', 'a']].map(([s, t]) => ({ id: s + t, source: s, target: t, kind: 'calls' as const, evidence: { path: 'x.ts', line: 1, explanation: 'x' }, confidence: 'high' as const, resolution: 'resolved' as const })),
    });
    expect([...traverse(cyc, ['a'], { direction: 'downstream', depth: 10 }).nodes].sort()).toEqual(['a', 'b', 'c']);
    expect(traverse(cyc, ['a'], { direction: 'downstream', depth: 1 }).nodes.size).toBe(2);
    expect(traverse(cyc, ['a'], { direction: 'downstream', depth: 10, maxNodes: 2 })).toMatchObject({ truncated: true });
  });

  it('resolves click-to-source locations to exact lines inside the workspace', () => {
    const root = path.join(FIXTURES, 'react-express');
    const handler = locationOfNode(index, root, 'sym:server/controllers/userController.ts#listUsers')!;
    expect(handler).toEqual({ file: path.join(root, 'server/controllers/userController.ts'), line: 4, column: 1 });
    const e = nodesOfKind(graph, 'api-endpoint').find((n) => n.metadata.path === '/api/users/:id')!;
    expect(locationOfNode(index, root, e.id)).toMatchObject({ file: path.join(root, 'server/routes/users.ts'), line: 9 });
    const edge = graph.edges.find((x) => x.kind === 'handles-route' && x.source === e.id)!;
    expect(locationOfEdge(index, root, edge.id)).toMatchObject({ line: 9 });
  });

  it('refuses locations for synthetic nodes and anything outside the workspace root', () => {
    const root = path.join(FIXTURES, 'react-express');
    expect(locationOfNode(index, root, 'external:api.stripe.com')).toBeUndefined();
    expect(locationOfNode(index, root, 'does-not-exist')).toBeUndefined();
    const evil = new GraphIndex({ schemaVersion: 1, nodes: [{ id: 'x', kind: 'function', name: 'x', path: '../../etc/passwd', startLine: 1, metadata: {} }], edges: [] });
    expect(locationOfNode(evil, root, 'x')).toBeUndefined();
  });
});

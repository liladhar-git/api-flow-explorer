import { describe, expect, it } from 'vitest';
import { analyzeFixture, nodesOfKind } from './helpers';
import { focusView, GraphIndex } from '../../src/graph/graphQueries';
import { initialState, reducer, type ViewState } from '../../webview/src/state/store';
import type { GraphNode } from '../../src/types/graph';

describe('the API tester follows the focused endpoint', async () => {
  const { graph } = await analyzeFixture('request-schemas');
  const index = new GraphIndex(graph);
  const ep = (m: string, p: string): GraphNode => nodesOfKind(graph, 'api-endpoint').find((e) => e.metadata.method === m && e.metadata.path === p)!;
  const subgraph = (id: string) => {
    const v = focusView(index, id, 1)!;
    return { type: 'subgraph' as const, nodes: v.nodes, edges: v.edges, hidden: v.hidden, truncated: false, focusId: id };
  };
  const host = (state: ViewState, id: string) => reducer(state, { type: 'host', msg: subgraph(id) });
  const open = (state: ViewState, node: GraphNode) =>
    reducer(state, { type: 'prepopulateFromEndpoint', endpoint: { method: String(node.metadata.method), path: String(node.metadata.path), id: node.id, requestSchema: node.metadata.requestSchema as string } });

  const a = ep('PATCH', '/users/:id');
  const b = ep('GET', '/users');
  const c = ep('POST', '/users/:id/note');

  it('focusing another endpoint (sidebar click) replaces method, URL, path variables, params and body', () => {
    let s = host(initialState, a.id);
    s = open(s, a);
    expect(s.activeTab).toBe('tester');
    expect(s.activeRequest).toMatchObject({ method: 'PATCH', url: '{{baseUrl}}/users/:id', endpointId: a.id });
    expect(s.activeRequest.pathParams?.map((p) => p.key)).toEqual(['id']);
    expect(s.activeRequest.body.type).toBe('json');

    s = host(s, b.id); // user clicks GET /users in the sidebar while the tester is open
    expect(s.activeTab).toBe('tester'); // stays on the tester page
    expect(s.activeRequest).toMatchObject({ method: 'GET', url: '{{baseUrl}}/users', endpointId: b.id });
    expect(s.activeRequest.pathParams).toEqual([]); // nothing left over from the previous endpoint
    expect(s.activeRequest.queryParams.map((q) => q.key)).toEqual(['page', 'search', 'order']);
    expect(s.activeRequest.body).toEqual({ type: 'none', content: '' });

    s = host(s, c.id);
    expect(s.activeRequest.url).toBe('{{baseUrl}}/users/:id/note');
    expect(s.activeRequest.queryParams).toEqual([]);
    expect(JSON.parse(s.activeRequest.body.content)).toEqual({ text: '' });
  });

  it('keeps your headers, auth and Base URL; clears the previous response', () => {
    let s = open(host(initialState, a.id), a);
    s = {
      ...s,
      environmentVariables: { ...s.environmentVariables, baseUrl: 'https://stage.example.com' },
      activeRequest: { ...s.activeRequest, auth: { type: 'bearer', token: 'secret' }, headers: [{ key: 'X-Tenant', value: '7', enabled: true }] },
      activeResponse: { requestId: 'r', status: 200, statusText: 'OK', durationMs: 1, sizeBytes: 1, headers: {}, body: '{}', isJson: true, truncated: false, timing: { start: 0, end: 1 } },
    };
    s = host(s, b.id);
    expect(s.activeRequest.auth).toEqual({ type: 'bearer', token: 'secret' });
    expect(s.activeRequest.headers).toEqual([{ key: 'X-Tenant', value: '7', enabled: true }]);
    expect(s.environmentVariables.baseUrl).toBe('https://stage.example.com');
    expect(s.activeResponse).toBeUndefined();
  });

  it('re-focusing the same endpoint (depth change, refresh) does not wipe what you typed (negative)', () => {
    let s = open(host(initialState, a.id), a);
    s = { ...s, activeRequest: { ...s.activeRequest, pathParams: [{ key: 'id', value: '42', enabled: true }], body: { type: 'json', content: '{"email":"a@b.co"}' } } };
    const again = host(s, a.id);
    expect(again.activeRequest.pathParams).toEqual([{ key: 'id', value: '42', enabled: true }]);
    expect(again.activeRequest.body.content).toBe('{"email":"a@b.co"}');
    expect(again.activeRequest.id).toBe(s.activeRequest.id);
  });

  it('focusing something that is not an endpoint leaves the request alone (negative)', () => {
    const s = open(host(initialState, a.id), a);
    const handler = graph.edges.find((e) => e.kind === 'handles-route' && e.source === a.id)!.target;
    const next = host(s, handler);
    expect(next.activeRequest).toEqual(s.activeRequest);
    expect(next.focusId).toBe(handler);
  });

  it('selecting a different endpoint node in the graph also re-points the tester; the same one keeps edits', () => {
    let s = open(host(initialState, a.id), a);
    s = { ...s, nodes: [...s.nodes, b] };
    const typed = { ...s, activeRequest: { ...s.activeRequest, pathParams: [{ key: 'id', value: '9', enabled: true }] } };
    expect(reducer(typed, { type: 'select', selection: { type: 'node', id: a.id } }).activeRequest.pathParams?.[0].value).toBe('9');
    const switched = reducer(typed, { type: 'select', selection: { type: 'node', id: b.id } });
    expect(switched.activeRequest).toMatchObject({ method: 'GET', url: '{{baseUrl}}/users', endpointId: b.id, pathParams: [] });
  });
});

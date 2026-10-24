import { describe, expect, it } from 'vitest';
import { analyzeFixture, edge, nodesOfKind } from './helpers';
import { matchSegments, parsePattern, resolveUrl } from '../../src/analyzer/pathUtils';

describe('path utilities', () => {
  it('resolves env holes from configuration and normalizes paths', () => {
    const r = resolveUrl([{ hole: 'process.env.A', reason: 'env', env: 'A' }, '/users//1/?x=1'], { A: 'https://api.test/v1' });
    expect(r).toMatchObject({ origin: 'https://api.test', path: '/v1/users/1', baseUnknown: false });
  });
  it('flags unresolved leading base and whole-segment holes', () => {
    const r = resolveUrl([{ hole: 'BASE', reason: 'expr' }, '/users/', { hole: 'id', reason: 'expr' }]);
    expect(r).toMatchObject({ baseUnknown: true, path: '/users/:id', dynamicSegments: 1 });
  });
  it('request holes match route params but never route literals', () => {
    const req = resolveUrl(['/a/', { hole: 'x', reason: 'expr' }]).segments;
    expect(matchSegments(req, parsePattern('/a/:id')).matched).toBe(true);
    expect(matchSegments(req, parsePattern('/a/me')).matched).toBe(false);
    expect(matchSegments(resolveUrl(['/a/b/c']).segments, parsePattern('/a/*')).matched).toBe(true);
    expect(matchSegments(resolveUrl(['/a']).segments, parsePattern('/a/b')).matched).toBe(false);
  });
});

describe('frontend → backend matching (react-express)', async () => {
  const { graph, report } = await analyzeFixture('react-express');
  const ep = (m: string, p: string) => nodesOfKind(graph, 'api-endpoint').find((e) => e.metadata.method === m && e.metadata.path === p)!;
  const req = (re: RegExp) => nodesOfKind(graph, 'api-client').find((n) => re.test(n.id))!;
  const hr = (reqId: string) => graph.edges.filter((e) => e.kind === 'http-request' && e.source === reqId);

  it('resolves axios instances with a static baseURL and joins it with the path', () => {
    const list = req(/api\/users\.ts:3:/);
    expect(list.metadata).toMatchObject({ library: 'axios', method: 'GET', normalizedPath: '/api/users' });
    expect(edge(graph, 'http-request', list.id, ep('GET', '/api/users').id)).toMatchObject({ confidence: 'high', resolution: 'resolved' });
    expect(edge(graph, 'http-request', req(/api\/users\.ts:5:/).id, ep('POST', '/api/users').id)).toMatchObject({ confidence: 'high' });
  });

  it('matches template-literal URLs to parameterized routes as inferred', () => {
    const e = edge(graph, 'http-request', req(/api\/users\.ts:4:/).id, ep('GET', '/api/users/:id').id)!;
    expect(e).toMatchObject({ confidence: 'medium', resolution: 'inferred' });
    expect(e.reason).toMatch(/dynamic path segment/);
    expect(edge(graph, 'http-request', req(/UsersPage\.tsx:16:/).id, ep('PUT', '/api/users/:id/avatar').id)).toBeDefined(); // fetch with {method:'PUT'}
    expect(edge(graph, 'http-request', req(/UsersPage\.tsx:12:/).id, ep('DELETE', '/api/orders/:orderId').id)).toBeDefined();
  });

  it('propagates static URLs through API wrapper functions to the call site', () => {
    const wrapped = req(/http\.ts:2:10@client\/src\/pages\/UsersPage\.tsx:24/);
    expect(wrapped).toMatchObject({ path: 'client/src/pages/UsersPage.tsx', startLine: 24, metadata: { viaWrapper: 'getJson' } });
    expect(edge(graph, 'http-request', wrapped.id, ep('GET', '/api/users').id)).toMatchObject({ confidence: 'high' });
    expect(edge(graph, 'calls', 'sym:client/src/pages/UsersPage.tsx#loadViaWrapper', wrapped.id)).toBeDefined();
  });

  it('wires component → hook → api function → request', () => {
    expect(edge(graph, 'calls', 'sym:client/src/hooks/useUsers.ts#useUsers', 'sym:client/src/api/users.ts#fetchUsers')).toBeDefined();
    expect(edge(graph, 'calls', 'sym:client/src/api/users.ts#fetchUsers', req(/api\/users\.ts:3:/).id)).toBeDefined();
    expect(edge(graph, 'renders', 'sym:client/src/components/UserList.tsx#UserList', 'sym:client/src/components/UserCard.tsx#UserCard')).toBeDefined();
  });

  it('keeps unknown base URLs low-confidence and explains why', () => {
    const e = hr(req(/UsersPage\.tsx:20:/).id)[0];
    expect(e).toMatchObject({ confidence: 'low', resolution: 'inferred' });
    expect(e.reason).toMatch(/REACT_APP_API_URL/);
  });

  it('records unmatched requests as unresolved with the reason (negative)', () => {
    const e = hr(req(/UsersPage\.tsx:28:/).id)[0];
    expect(e).toMatchObject({ resolution: 'unresolved', confidence: 'low' });
    expect(e.reason).toMatch(/no endpoint matches GET \/api\/does-not-exist/);
    expect(graph.nodes.find((n) => n.id === e.target)!.kind).toBe('unknown');
    expect(report.diagnostics.some((d) => d.code === 'unmatched-request')).toBe(true);
  });

  it('represents dynamic URLs as unresolved instead of guessing', () => {
    const e = hr(req(/UsersPage\.tsx:37:/).id)[0];
    expect(e).toMatchObject({ resolution: 'unresolved' });
    expect(e.reason).toMatch(/dynamic expression/);
  });

  it('targets external APIs without matching local routes', () => {
    const e = hr(req(/UsersPage\.tsx:32:/).id);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ target: 'external:api.stripe.com', resolution: 'resolved' });
  });

  it('never links a request to routes merely because names look alike (negative)', () => {
    expect(edge(graph, 'http-request', req(/UsersPage\.tsx:7:/).id, ep('GET', '/api/users').id)).toBeUndefined();
    expect(edge(graph, 'http-request', req(/api\/users\.ts:3:/).id, ep('GET', '/api/orders').id)).toBeUndefined();
  });

  it('keeps data-access edges for Mongoose models declared with mongoose.model()', () => {
    expect(edge(graph, 'reads', 'sym:server/services/userService.ts#findAll', 'model:User')).toBeDefined();
    expect(edge(graph, 'writes', 'sym:server/services/userService.ts#create', 'model:User')).toBeDefined(); // new User(data).save()
    expect(edge(graph, 'writes', 'sym:server/services/userService.ts#findAll', 'model:User')).toBeUndefined();
    expect(edge(graph, 'writes', 'sym:server/controllers/orderController.ts#orderController.remove', 'model:Order')).toBeDefined();
  });
});

describe('dynamic and ambiguous paths (dynamic-routing)', async () => {
  const { graph, report } = await analyzeFixture('dynamic-routing');
  const req = (line: number) => nodesOfKind(graph, 'api-client').find((n) => n.startLine === line)!;
  const outs = (line: number) => graph.edges.filter((e) => e.kind === 'http-request' && e.source === req(line).id);

  it('marks equal matches as ambiguous (inferred, low) and reports them', () => {
    const e = outs(6);
    expect(e).toHaveLength(2);
    for (const x of e) expect(x).toMatchObject({ confidence: 'low', resolution: 'inferred' });
    expect(report.diagnostics.some((d) => d.code === 'ambiguous-match' && d.line === 6)).toBe(true);
  });

  it('prefers the more specific literal route over a parameterized one', () => {
    expect(outs(7)).toHaveLength(1);
    expect(outs(7)[0].target).toMatch(/GET \/api\/users\/me@/);
    expect(outs(7)[0]).toMatchObject({ confidence: 'high' });
  });

  it('a dynamic request segment matches route params but not a route literal', () => {
    expect(outs(8)[0].target).toMatch(/GET \/api\/users\/:id@/);
    expect(outs(11)[0]).toMatchObject({ resolution: 'unresolved' }); // only /only-me/me exists
  });

  it('partially dynamic segments and unknown methods lower confidence', () => {
    expect(outs(9)[0]).toMatchObject({ confidence: 'low', resolution: 'inferred' });
    expect(outs(10)[0]).toMatchObject({ confidence: 'low', resolution: 'inferred' });
    expect(outs(10)[0].reason).toMatch(/method/);
  });

  it('respects HTTP method when it is known (negative)', () => {
    expect(outs(14)[0]).toMatchObject({ resolution: 'unresolved' }); // GET /api/things, only POST exists
  });

  it('uses env fallback values as medium-confidence evidence', () => {
    expect(outs(12)[0]).toMatchObject({ confidence: 'medium', resolution: 'inferred' });
    expect(outs(12)[0].reason).toMatch(/default of an unconfigured environment variable/);
  });

  it('resolves a configured baseURL environment variable', async () => {
    const configured = await analyzeFixture('dynamic-routing', { baseUrls: { API_BASE_URL: 'http://localhost:4000/api' } });
    const e = configured.graph.edges.filter((x) => x.kind === 'http-request' && /calls\.ts:13/.test(x.source));
    expect(e.length).toBeGreaterThan(0); // base path /api + /api/items => /api/api/items does not exist
    expect(e.every((x) => x.resolution === 'unresolved')).toBe(true);
    const ok = await analyzeFixture('dynamic-routing', { baseUrls: { API_BASE_URL: 'http://localhost:4000' } });
    expect(ok.graph.edges.filter((x) => x.kind === 'http-request' && /calls\.ts:13/.test(x.source) && x.resolution !== 'unresolved').length).toBe(2);
  });
});

describe('monorepo workspaces', async () => {
  const { graph, report } = await analyzeFixture('monorepo');

  it('discovers packages and resolves cross-package aliases and constants', () => {
    expect(report.packages.map((p) => p.name).sort()).toEqual(['@acme/api', '@acme/shared', '@acme/web', 'mono']);
    const e = nodesOfKind(graph, 'api-endpoint');
    expect(e.map((x) => x.metadata.path)).toEqual(['/api/users']); // route path from a constant imported across packages
    expect(edge(graph, 'handles-route', e[0].id, 'sym:apps/api/src/users.ts#listUsers')).toBeDefined(); // via "@/users"
  });

  it('propagates wrapper calls across packages', () => {
    const req = nodesOfKind(graph, 'api-client')[0];
    expect(req).toMatchObject({ path: 'apps/web/src/App.tsx' });
    expect(edge(graph, 'http-request', req.id, /GET \/api\/users@apps\/api/)).toMatchObject({ confidence: 'high' });
    expect(edge(graph, 'renders', 'sym:apps/web/src/App.tsx#App', 'sym:apps/web/src/Header.tsx#Header')).toBeDefined();
  });

  it('warns when the same alias maps to different packages', () => {
    expect(report.diagnostics.some((d) => d.code === 'config' && /"@\/\*"/.test(d.message))).toBe(true);
  });
});

import { EndpointIndex, type EndpointEntry } from '../../src/analyzer/endpointMatcher';

describe('endpoint index (differential test against brute force)', () => {
  // small deterministic PRNG so failures are reproducible
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

  it('returns exactly the endpoints a full scan would match', () => {
    const rand = rng(12345);
    const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
    const patternSeg = () => pick(['a', 'b', 'c', 'api', ':id', ':p?', '*', '*rest']);
    for (let round = 0; round < 60; round++) {
      const endpoints: EndpointEntry[] = Array.from({ length: 40 }, (_, i) => {
        const path = '/' + Array.from({ length: 1 + Math.floor(rand() * 4) }, patternSeg).join('/');
        return { node: { id: `e${i}`, kind: 'api-endpoint' as const, name: path, metadata: { path, method: 'GET' } }, method: 'GET', segments: parsePattern(path) };
      });
      const index = new EndpointIndex(endpoints);
      for (let q = 0; q < 60; q++) {
        const parts: (string | { hole: string; reason: 'expr' })[] = [];
        const len = Math.floor(rand() * 5);
        for (let i = 0; i < len; i++) parts.push('/', rand() < 0.25 ? { hole: 'x', reason: 'expr' as const } : pick(['a', 'b', 'c', 'api', 'zzz']));
        const req = resolveUrl(parts.length ? parts : ['/']).segments;
        const viaIndex = new Set(index.candidates(req).filter((e) => matchSegments(req, e.segments).matched).map((e) => e.node.id));
        const brute = new Set(endpoints.filter((e) => matchSegments(req, e.segments).matched).map((e) => e.node.id));
        expect([...viaIndex].sort(), `round ${round} query ${JSON.stringify(parts)}`).toEqual([...brute].sort());
      }
    }
  });
});

describe('recursive API wrappers', async () => {
  const { graph } = await analyzeFixture('recursive-wrappers');
  it('terminates and still resolves static URLs through self- and mutually-recursive wrappers', () => {
    const targets = graph.edges.filter((e) => e.kind === 'http-request' && e.resolution !== 'unresolved').map((e) => e.target);
    expect(targets.some((t) => /GET \/api\/items@/.test(t))).toBe(true);
    expect(targets.some((t) => /GET \/api\/other@/.test(t))).toBe(true);
  });
});

describe('URL idioms (url-idioms fixture)', async () => {
  const { graph, report } = await analyzeFixture('url-idioms');
  const req = (name: string) => nodesOfKind(graph, 'api-client').find((n) => n.metadata.rawUrl !== undefined && graph.edges.some((e) => e.kind === 'calls' && e.target === n.id && e.source.endsWith(`#${name}`)) || graph.edges.some((e) => e.kind === 'calls' && e.target === n.id && e.source.endsWith(`#CommentsClient.${name}`)))!;
  const out = (name: string) => graph.edges.filter((e) => e.kind === 'http-request' && e.source === req(name).id);

  it('sees through base.replace(/\\/+$/, "") and uses the env fallback as medium evidence', () => {
    const [e] = out('viaReplaceIdiom');
    expect(e.target).toMatch(/GET \/health@/);
    expect(e).toMatchObject({ confidence: 'medium', resolution: 'inferred' });
    expect(e.reason).toMatch(/default of an unconfigured environment variable/);
  });

  it('evaluates single-expression URL builder helpers at the call site', () => {
    const [e] = out('viaBuildUrl');
    expect(e.target).toMatch(/GET \/health@/);
    expect(e.resolution).toBe('inferred');
  });

  it('treats a trailing query-string hole as a query, not a path segment', () => {
    for (const [name, route] of [['trailingQueryParam', /GET \/video-assets@/], ['trailingQueryOnSegment', /GET \/video-assets\/stats@/]] as const) {
      const edges = out(name);
      expect(edges, name).toHaveLength(1); // not ambiguous
      expect(edges[0].target).toMatch(route);
    }
  });

  it('still treats a real parameter segment as dynamic (negative)', () => {
    const [e] = out('realParamSegment');
    expect(e.target).toMatch(/GET \/video-assets\/:id@/);
    expect(e.reason).toMatch(/dynamic path segment/);
  });

  it('resolves Nest ConfigService.get() through apiFlowExplorer.baseUrls and explains it otherwise', async () => {
    const [e] = out('remove');
    expect(e.resolution).not.toBe('resolved');
    expect(e.reason ?? '').toMatch(/SSO_URL/);
    const cfg = await analyzeFixture('url-idioms', { baseUrls: { SSO_URL: 'https://sso.example.com' } });
    // the configured base makes the request internal, so the failure is about the *method* (the route is GET-only)
    expect(cfg.graph.edges.some((x) => x.kind === 'http-request' && /DELETE \/api\/internal\/comments\/:id@/.test(x.target))).toBe(false);
    expect(cfg.graph.edges.some((x) => x.kind === 'http-request' && x.resolution === 'unresolved' && /no endpoint matches DELETE \/api\/internal\/comments\/:id/.test(x.reason ?? ''))).toBe(true);
  });

  it('does not treat other classes with a get() method as ConfigService (negative)', () => {
    const [e] = out('lookalike');
    expect(e).toMatchObject({ confidence: 'low', resolution: 'inferred' });
    expect(e.reason).not.toMatch(/environment variable SSO_URL/);
    expect(e.reason).toMatch(/unresolved expression/);
  });

  it('does not report stylesheet or asset imports as unresolved aliases', () => {
    expect(report.diagnostics.filter((d) => d.code === 'unresolved-alias' || d.code === 'unresolved-import')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { analyzeFixture, edge, node, nodesOfKind } from './helpers';

describe('express adapter: react-express fixture', async () => {
  const { graph, report } = await analyzeFixture('react-express');
  const endpoints = nodesOfKind(graph, 'api-endpoint');
  const ep = (method: string, path: string) => endpoints.find((e) => e.metadata.method === method && e.metadata.path === path);

  it('discovers every route with mounted prefixes applied', () => {
    expect(endpoints.map((e) => `${e.metadata.method} ${e.metadata.path}`).sort()).toEqual([
      'DELETE /api/orders/:orderId',
      'GET /api/orders',
      'GET /api/users',
      'GET /api/users/:id',
      'GET /health',
      'POST /api/users',
      'PUT /api/users/:id/avatar',
    ]);
  });

  it('records source locations and framework metadata', () => {
    const e = ep('GET', '/api/users/:id')!;
    expect(e).toMatchObject({ path: 'server/routes/users.ts', startLine: 9, metadata: { framework: 'express', router: 'router' } });
  });

  it('links routes to imported handlers, wrapped handlers and object-literal methods', () => {
    expect(edge(graph, 'handles-route', ep('GET', '/api/users')!.id, 'sym:server/controllers/userController.ts#listUsers')).toMatchObject({ confidence: 'high', resolution: 'resolved' });
    expect(edge(graph, 'handles-route', ep('POST', '/api/users')!.id, 'sym:server/controllers/userController.ts#createUser')).toBeDefined();
    expect(edge(graph, 'handles-route', ep('GET', '/api/orders')!.id, 'sym:server/controllers/orderController.ts#orderController.list')).toBeDefined();
  });

  it('attributes inline handlers so their calls reach services', () => {
    const inline = edge(graph, 'handles-route', ep('PUT', '/api/users/:id/avatar')!.id, /PUT \/:id\/avatar@L11$/)!;
    expect(inline).toBeDefined();
    expect(edge(graph, 'calls', inline.target, 'sym:server/services/userService.ts#setAvatar')).toBeDefined();
    expect(edge(graph, 'calls', 'sym:server/routes/users.ts#<module>', 'sym:server/services/userService.ts#setAvatar')).toBeUndefined();
  });

  it('distinguishes route-level, mount-level and router-level middleware by confidence', () => {
    const routeLevel = edge(graph, 'uses-middleware', ep('POST', '/api/users')!.id, 'sym:server/middleware/auth.ts#requireAuth')!;
    expect(routeLevel).toMatchObject({ confidence: 'high', resolution: 'resolved' });
    const mountLevel = edge(graph, 'uses-middleware', ep('GET', '/api/orders')!.id, 'sym:server/middleware/auth.ts#requireAuth')!;
    expect(mountLevel).toMatchObject({ confidence: 'high', resolution: 'resolved' });
    const appLevel = edge(graph, 'uses-middleware', ep('GET', '/health')!.id, 'sym:server/middleware/logger.ts#requestLogger')!;
    expect(appLevel).toMatchObject({ confidence: 'medium', resolution: 'inferred' });
    expect(node(graph, 'sym:server/middleware/auth.ts#requireAuth')!.kind).toBe('middleware');
  });

  it('does not attach middleware to routes it does not guard (negative)', () => {
    expect(edge(graph, 'uses-middleware', ep('GET', '/api/users')!.id, 'sym:server/middleware/auth.ts#requireAuth')).toBeUndefined();
    expect(edge(graph, 'uses-middleware', ep('GET', '/health')!.id, 'sym:server/middleware/auth.ts#requireAuth')).toBeUndefined();
  });

  it('emits router mounts', () => {
    expect(edge(graph, 'mounts-router', 'route:server/app.ts#app', 'route:server/routes/users.ts#router')).toMatchObject({ resolution: 'resolved' });
    expect(edge(graph, 'mounts-router', 'route:server/app.ts#app', 'route:server/routes/orders.ts#ordersRouter')).toBeDefined();
  });

  it('reports no unresolved-handler diagnostics for resolvable code', () => {
    expect(report.diagnostics.filter((d) => d.code === 'unresolved-handler')).toEqual([]);
  });
});

describe('express adapter: edge cases', async () => {
  const { graph, report } = await analyzeFixture('express-edge');
  const endpoints = nodesOfKind(graph, 'api-endpoint');
  const label = (e: (typeof endpoints)[number]) => `${e.metadata.method} ${e.metadata.path}`;

  it('resolves static const prefixes, CommonJS require() routers, arrays, template literals and app.all', () => {
    const labels = endpoints.map(label);
    expect(labels).toContain('GET /v1/legacy/ping');
    expect(labels).toContain('GET /a');
    expect(labels).toContain('GET /b');
    expect(labels).toContain('GET /v1/tpl/:id');
    expect(labels).toContain('ALL /any');
  });

  it('does not treat app.get(setting), static middleware or regex routes as endpoints (negative)', () => {
    const labels = endpoints.map(label);
    expect(labels.some((l) => l.includes('env'))).toBe(false);
    expect(labels.some((l) => l.includes('re'))).toBe(false);
    expect(report.diagnostics.some((d) => d.code === 'dynamic-route' && /Regular-expression/.test(d.message))).toBe(true);
  });

  it('reports unresolvable mounts explicitly instead of inventing routes', () => {
    expect(report.diagnostics.some((d) => d.code === 'unresolved-mount' && d.path === 'server.js')).toBe(true);
    const unresolved = graph.edges.find((e) => e.kind === 'mounts-router' && e.resolution === 'unresolved');
    expect(unresolved).toMatchObject({ confidence: 'low' });
    expect(unresolved!.reason).toBeTruthy();
  });

  it('marks routers that are never mounted as having an unknown prefix', () => {
    const orphan = endpoints.find((e) => e.metadata.path === '/orphan')!;
    expect(orphan.metadata.prefixUnknown).toBe(true);
    expect(edge(graph, 'handles-route', orphan.id, /orphan$/)).toMatchObject({ confidence: 'medium', resolution: 'inferred' });
  });

  it('terminates on cyclic router mounts', () => {
    expect(endpoints.some((e) => e.metadata.path === '/cycle/x')).toBe(true);
    expect(endpoints.filter((e) => String(e.metadata.path).startsWith('/cycle')).length).toBeLessThan(10);
  });
});

import { describe, expect, it } from 'vitest';
import { analyzeFixture, edge, node, nodesOfKind } from './helpers';
import { validateGraph } from '../../src/graph/graphValidator';

describe('nestjs adapter', async () => {
  const { graph, report } = await analyzeFixture('nestjs');
  const endpoints = nodesOfKind(graph, 'api-endpoint');
  const ep = (m: string, p: string) => endpoints.find((e) => e.metadata.method === m && e.metadata.path === p)!;
  const S = (f: string, n: string) => `sym:src/${f}#${n}`;

  it('builds a valid graph', () => {
    expect(validateGraph(graph).ok).toBe(true);
  });

  it('combines global prefix, controller prefix and method path', () => {
    expect(endpoints.map((e) => `${e.metadata.method} ${e.metadata.path}`).sort()).toEqual([
      'DELETE /api/users/:id',
      'GET /api/orders',
      'GET /api/products',
      'GET /api/search',
      'GET /api/users',
      'GET /api/users/:id',
      'POST /api/orders',
      'POST /api/users',
      'PUT /api/products/batch',
      'PUT /api/products/bulk',
    ]);
    expect(ep('GET', '/api/users')).toMatchObject({ path: 'src/users/users.controller.ts', startLine: 12, metadata: { framework: 'nestjs', controller: 'UsersController' } });
  });

  it('classifies controllers, services, guards and interceptors from decorators/interfaces', () => {
    expect(node(graph, S('users/users.controller.ts', 'UsersController'))!.kind).toBe('controller');
    expect(node(graph, S('users/users.service.ts', 'UsersService'))!.kind).toBe('service');
    expect(node(graph, S('auth/auth.guard.ts', 'AuthGuard'))!.kind).toBe('guard');
    expect(node(graph, S('common/logging.interceptor.ts', 'LoggingInterceptor'))!.kind).toBe('interceptor');
  });

  it('records constructor dependency injection', () => {
    expect(edge(graph, 'injects', S('users/users.controller.ts', 'UsersController'), S('users/users.service.ts', 'UsersService'))).toMatchObject({ confidence: 'high' });
    expect(edge(graph, 'injects', S('users/users.service.ts', 'UsersService'), S('mail/mail.service.ts', 'MailService'))).toBeDefined();
    expect(edge(graph, 'injects', S('users/users.service.ts', 'UsersService'), 'model:User')).toBeDefined();
    expect(edge(graph, 'injects', S('orders/orders.service.ts', 'OrdersService'), S('orders/prisma.service.ts', 'PrismaService'))).toBeDefined();
  });

  it('traces controller → service → data store', () => {
    expect(edge(graph, 'handles-route', ep('GET', '/api/users').id, S('users/users.controller.ts', 'UsersController.findAll'))).toBeDefined();
    expect(edge(graph, 'calls', S('users/users.controller.ts', 'UsersController.findAll'), S('users/users.service.ts', 'UsersService.findAll'))).toMatchObject({ confidence: 'high', resolution: 'resolved' });
    const read = edge(graph, 'reads', S('users/users.service.ts', 'UsersService.findAll'), 'model:User')!;
    expect(read.evidence).toMatchObject({ path: 'src/users/users.service.ts', line: 17 });
    expect(read.evidence.explanation).toContain('@InjectModel(User)');
  });

  it('distinguishes reads from writes, including model instances', () => {
    expect(edge(graph, 'writes', S('users/users.service.ts', 'UsersService.create'), 'model:User')).toBeDefined(); // new this.userModel(dto).save()
    expect(edge(graph, 'writes', S('users/users.service.ts', 'UsersService.remove'), 'model:User')).toBeDefined();
    expect(edge(graph, 'writes', S('users/users.service.ts', 'UsersService.findAll'), 'model:User')).toBeUndefined();
    expect(edge(graph, 'reads', S('users/users.service.ts', 'UsersService.create'), 'model:User')).toBeUndefined();
  });

  it('supports Prisma, TypeORM, Redis, Elasticsearch', () => {
    expect(edge(graph, 'reads', S('orders/orders.service.ts', 'OrdersService.list'), 'model:Order')).toBeDefined();
    expect(edge(graph, 'writes', S('orders/orders.service.ts', 'OrdersService.create'), 'model:Order')).toBeDefined();
    expect(edge(graph, 'reads', S('products/products.service.ts', 'ProductsService.all'), 'model:Product')).toBeDefined();
    expect(edge(graph, 'writes', S('products/products.service.ts', 'ProductsService.save'), 'model:Product')).toBeDefined();
    expect(edge(graph, 'reads', S('cache/cache.service.ts', 'CacheService.get'), 'database:redis')).toBeDefined();
    expect(edge(graph, 'writes', S('cache/cache.service.ts', 'CacheService.invalidate'), 'database:redis')).toBeDefined();
    const es = edge(graph, 'reads', S('search/search.service.ts', 'SearchService.find'), 'database:elasticsearch')!;
    expect(es.evidence.explanation).toContain('index "products"');
  });

  it('shares one node per model and never links by name similarity (negative)', () => {
    expect(nodesOfKind(graph, 'model').map((n) => n.id).sort()).toEqual(['model:Order', 'model:Product', 'model:User']);
    expect(edge(graph, 'reads', /OrdersService/, 'model:User')).toBeUndefined();
    expect(edge(graph, 'reads', /ProductsService/, 'model:Order')).toBeUndefined();
    expect(node(graph, 'model:User')).toMatchObject({ path: 'src/users/schemas/user.schema.ts', startLine: 3 });
  });

  it('attaches guards at class and method level, and interceptors', () => {
    const del = ep('DELETE', '/api/users/:id').id;
    expect(edge(graph, 'uses-guard', del, S('auth/auth.guard.ts', 'AuthGuard'))!.evidence.explanation).toMatch(/class-level/);
    expect(edge(graph, 'uses-guard', del, S('auth/admin.guard.ts', 'AdminGuard'))!.evidence.explanation).toMatch(/method-level/);
    expect(edge(graph, 'uses-guard', ep('GET', '/api/users').id, S('auth/admin.guard.ts', 'AdminGuard'))).toBeUndefined();
    expect(edge(graph, 'uses-middleware', ep('POST', '/api/users').id, S('common/logging.interceptor.ts', 'LoggingInterceptor'))).toBeDefined();
    expect(edge(graph, 'uses-middleware', ep('GET', '/api/users').id, S('common/logging.interceptor.ts', 'LoggingInterceptor'))).toBeUndefined();
  });

  it('records queue publishers and consumers following execution flow', () => {
    expect(edge(graph, 'publishes', S('mail/mail.service.ts', 'MailService.sendGoodbye'), 'queue:mail')).toBeDefined();
    expect(edge(graph, 'subscribes', 'queue:mail', S('mail/mail.processor.ts', 'MailProcessor.handleGoodbye'))).toBeDefined();
  });

  it('records module registration as metadata without assuming instantiation', () => {
    expect(node(graph, S('users/users.controller.ts', 'UsersController'))!.metadata.registeredIn).toEqual(['UsersModule']);
    expect(node(graph, S('orders/orders.service.ts', 'OrdersService'))!.metadata.registeredIn).toEqual(['AppModule']);
    expect(report.diagnostics.filter((d) => /not registered/.test(d.message))).toEqual([]);
  });
});

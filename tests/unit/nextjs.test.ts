import { describe, expect, it } from 'vitest';
import { analyzeFixture, edge, node, nodesOfKind } from './helpers';
import { nextSegmentsToPath } from '../../src/analyzer/adapters/nextjs';

describe('nextjs adapter', async () => {
  const { graph } = await analyzeFixture('nextjs');
  const endpoints = nodesOfKind(graph, 'api-endpoint');
  const ep = (m: string, p: string) => endpoints.find((e) => e.metadata.method === m && e.metadata.path === p)!;

  it('converts file-system segments to route patterns', () => {
    expect(nextSegmentsToPath('api/users/[id]')).toBe('/api/users/:id');
    expect(nextSegmentsToPath('(shop)/cart')).toBe('/cart');
    expect(nextSegmentsToPath('files/[...path]')).toBe('/files/*path');
    expect(nextSegmentsToPath('docs/[[...slug]]')).toBe('/docs/*');
    expect(nextSegmentsToPath('@modal/photo')).toBe('/photo');
    expect(nextSegmentsToPath(undefined)).toBe('/');
  });

  it('discovers App Router route handlers per exported method, including aliased re-exports', () => {
    const labels = endpoints.filter((e) => e.metadata.router === 'app').map((e) => `${e.metadata.method} ${e.metadata.path}`).sort();
    expect(labels).toEqual([
      'DELETE /api/products/:id', 'GET /api/files/*path', 'GET /api/products', 'GET /api/products/:id', 'GET /cart', 'POST /api/products', 'PUT /api/products/:id',
    ]);
    expect(edge(graph, 'handles-route', ep('PUT', '/api/products/:id').id, /route\.ts#handler$/)).toMatchObject({ confidence: 'high' });
  });

  it('discovers Pages Router API routes, inferring methods from req.method checks', () => {
    expect(ep('GET', '/api/users')).toMatchObject({ metadata: { router: 'pages', methodInferred: true } });
    expect(ep('POST', '/api/users')).toBeDefined();
    expect(ep('DELETE', '/api/users/:id')).toBeDefined(); // switch (req.method)
    expect(endpoints.some((e) => e.metadata.method === 'PUT' && e.metadata.path === '/api/users')).toBe(false);
    expect(edge(graph, 'handles-route', ep('GET', '/api/users').id, /index\.ts#handler$/)).toMatchObject({ confidence: 'medium', resolution: 'inferred' });
  });

  it('treats an API route without method checks as accepting every method', () => {
    expect(ep('ALL', '/api/ping')).toBeDefined();
    expect(edge(graph, 'handles-route', ep('ALL', '/api/ping').id, /ping$/)).toMatchObject({ confidence: 'high' });
  });

  it('classifies pages and ignores API files as pages (negative)', () => {
    expect(nodesOfKind(graph, 'frontend-page').map((n) => n.metadata.route).sort()).toEqual(['/', '/products/:id', '/users', '/users/:id']);
    expect(nodesOfKind(graph, 'frontend-page').some((n) => n.path!.includes('/api/'))).toBe(false);
  });

  it('identifies client vs server execution', () => {
    const exec = (id: RegExp) => nodesOfKind(graph, 'api-client').find((n) => id.test(n.id))!.metadata.execution;
    expect(exec(/app\/page\.tsx/)).toBe('server'); // server component without 'use client'
    expect(exec(/ProductList\.tsx/)).toBe('client'); // 'use client'
    expect(exec(/pages\/users\/index\.tsx/)).toBe('server'); // inside getServerSideProps
    expect(exec(/pages\/users\/\[id\]\.tsx/)).toBe('client'); // component effect
  });

  it('links requests to route handlers and follows handlers to data access', () => {
    const req = (re: RegExp) => nodesOfKind(graph, 'api-client').find((n) => re.test(n.id))!;
    expect(edge(graph, 'http-request', req(/ProductList\.tsx/).id, ep('GET', '/api/products').id)).toMatchObject({ confidence: 'high', resolution: 'resolved' });
    expect(edge(graph, 'http-request', req(/AddToCart\.tsx:5/).id, ep('POST', '/api/products').id)).toMatchObject({ confidence: 'high' });
    expect(edge(graph, 'handles-route', ep('GET', '/api/products').id, 'sym:src/app/api/products/route.ts#GET')).toBeDefined();
    expect(edge(graph, 'calls', 'sym:src/app/api/products/route.ts#GET', 'sym:src/lib/products.ts#listProducts')).toBeDefined();
    expect(edge(graph, 'reads', 'sym:src/lib/products.ts#listProducts', 'model:Product')).toBeDefined();
    expect(edge(graph, 'writes', 'sym:src/lib/products.ts#removeProduct', 'model:Product')).toBeDefined();
    expect(edge(graph, 'writes', 'sym:src/lib/products.ts#listProducts', 'model:Product')).toBeUndefined();
  });

  it('matches absolute localhost URLs to local endpoints and marks method-inferred matches', () => {
    expect(edge(graph, 'http-request', /pages\/users\/index\.tsx/, ep('GET', '/api/users').id)).toMatchObject({ confidence: 'medium', resolution: 'inferred' });
    expect(edge(graph, 'http-request', /app\/page\.tsx/, ep('GET', '/api/products').id)).toMatchObject({ confidence: 'high' });
  });

  it('keeps an unconfigured env base URL low-confidence and resolves it once configured', async () => {
    const env = nodesOfKind(graph, 'api-client').find((n) => /Remote\.tsx/.test(n.id))!;
    expect(edge(graph, 'http-request', env.id, ep('GET', '/api/products').id)).toMatchObject({ confidence: 'low', resolution: 'inferred' });
    expect(edge(graph, 'http-request', env.id, ep('GET', '/api/products').id)!.reason).toMatch(/NEXT_PUBLIC_API_URL/);
    const configured = await analyzeFixture('nextjs', { baseUrls: { NEXT_PUBLIC_API_URL: 'https://shop.example.com' } });
    const e = edge(configured.graph, 'http-request', /Remote\.tsx/, /GET \/api\/products@/)!;
    expect(e).toMatchObject({ confidence: 'high', resolution: 'resolved' });
  });

  it('does not create pages or endpoints for non-Next code (negative)', async () => {
    const other = await analyzeFixture('react-express');
    expect(nodesOfKind(other.graph, 'frontend-page')).toEqual([]);
    expect(node(graph, 'sym:src/lib/products.ts#listProducts')).toBeDefined();
  });
});

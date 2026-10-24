import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  executeApiRequest,
  generateCurlCommand,
  resolveHeaders,
  resolveRequestUrl,
  substituteVariables,
} from '../../src/apiTest/requestRunner';
import type { ApiRequest } from '../../src/types/apiTest';

describe('API Tester Runner', () => {
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (url.pathname === '/api/slow') {
        // Delay 500ms
        await new Promise((r) => setTimeout(r, 500));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ delayed: true }));
        return;
      }

      if (url.pathname === '/api/echo') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          res.writeHead(200, {
            'content-type': 'application/json',
            'x-custom-echo': req.headers['x-custom-header'] || 'none',
            'x-auth-echo': req.headers['authorization'] || 'none',
          });
          res.end(
            JSON.stringify({
              method: req.method,
              query: Object.fromEntries(url.searchParams.entries()),
              body: body ? JSON.parse(body) : null,
            })
          );
        });
        return;
      }

      if (url.pathname === '/api/large') {
        const chunk = 'A'.repeat(1024); // 1KB
        const total = 50; // 50KB
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(chunk.repeat(total));
        return;
      }

      if (url.pathname === '/api/error') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  describe('Variable Substitution', () => {
    it('substitutes single and multiple variables correctly', () => {
      const vars = { host: 'localhost', port: '3000', prefix: 'api' };
      expect(substituteVariables('http://{{host}}:{{port}}/{{prefix}}/users', vars)).toBe(
        'http://localhost:3000/api/users'
      );
    });

    it('leaves undefined variables intact', () => {
      const vars = { host: 'localhost' };
      expect(substituteVariables('http://{{host}}:{{port}}/api', vars)).toBe('http://localhost:{{port}}/api');
    });

    it('handles empty or non-string inputs safely', () => {
      expect(substituteVariables('', {})).toBe('');
    });
  });

  describe('URL Resolution', () => {
    it('prepends baseUrl when a relative path is given', () => {
      const url = resolveRequestUrl('/api/users', [], { baseUrl: 'http://localhost:8080' });
      expect(url).toBe('http://localhost:8080/api/users');
    });

    it('fills :name path segments from path variables and leaves unfilled ones visible', () => {
      const vars = { baseUrl: 'http://api.test' };
      const rows = [{ key: 'id', value: '42', enabled: true }, { key: 'slug', value: '', enabled: true }];
      expect(resolveRequestUrl('{{baseUrl}}/users/:id/posts/:slug', [], vars, rows)).toBe('http://api.test/users/42/posts/:slug');
      expect(resolveRequestUrl('{{baseUrl}}/users/:id', [], vars, [{ key: 'id', value: 'a b/c', enabled: true }])).toBe('http://api.test/users/a%20b%2Fc'); // encoded
      expect(resolveRequestUrl('{{baseUrl}}/users/:id', [], vars, [{ key: 'id', value: '{{uid}}', enabled: true }])).toBe('http://api.test/users/%7B%7Buid%7D%7D'); // an undefined variable stays literal (encoded)
      expect(resolveRequestUrl('{{baseUrl}}/users/:id', [], { ...vars, uid: '7' }, [{ key: 'id', value: '{{uid}}', enabled: true }])).toBe('http://api.test/users/7');
      expect(resolveRequestUrl('http://localhost:3000/a/:id', [], {}, [{ key: 'id', value: '1', enabled: true }])).toBe('http://localhost:3000/a/1'); // the port colon is not a param
    });

    it('appends enabled query parameters and skips disabled ones', () => {
      const params = [
        { key: 'page', value: '1', enabled: true },
        { key: 'limit', value: '20', enabled: true },
        { key: 'disabled', value: 'true', enabled: false },
        { key: '', value: 'empty', enabled: true },
      ];
      const url = resolveRequestUrl('http://example.com/api', params, {});
      expect(url).toBe('http://example.com/api?page=1&limit=20');
    });

    it('merges with existing query parameters in the URL', () => {
      const params = [{ key: 'b', value: '2', enabled: true }];
      const url = resolveRequestUrl('http://example.com/api?a=1', params, {});
      expect(url).toBe('http://example.com/api?a=1&b=2');
    });
  });

  describe('Headers & Auth Resolution', () => {
    it('includes enabled headers and substitutes variables', () => {
      const req: ApiRequest = {
        id: '1',
        method: 'GET',
        url: 'http://example.com',
        queryParams: [],
        headers: [
          { key: 'X-Api-Key', value: '{{apiKey}}', enabled: true },
          { key: 'X-Disabled', value: 'hidden', enabled: false },
        ],
        auth: { type: 'none' },
        body: { type: 'none', content: '' },
        timeoutMs: 5000,
      };
      const headers = resolveHeaders(req, { apiKey: 'secret-123' });
      expect(headers['X-Api-Key']).toBe('secret-123');
      expect(headers['X-Disabled']).toBeUndefined();
    });

    it('formats Bearer token authorization header', () => {
      const req: ApiRequest = {
        id: '2',
        method: 'GET',
        url: 'http://example.com',
        queryParams: [],
        headers: [],
        auth: { type: 'bearer', token: '{{myToken}}' },
        body: { type: 'none', content: '' },
        timeoutMs: 5000,
      };
      const headers = resolveHeaders(req, { myToken: 'jwt-xyz' });
      expect(headers['Authorization']).toBe('Bearer jwt-xyz');
    });

    it('formats Basic auth header', () => {
      const req: ApiRequest = {
        id: '3',
        method: 'GET',
        url: 'http://example.com',
        queryParams: [],
        headers: [],
        auth: { type: 'basic', username: 'admin', password: 'password123' },
        body: { type: 'none', content: '' },
        timeoutMs: 5000,
      };
      const headers = resolveHeaders(req, {});
      expect(headers['Authorization']).toBe(`Basic ${btoa('admin:password123')}`);
    });

    it('defaults Content-Type to application/json for json bodies', () => {
      const req: ApiRequest = {
        id: '4',
        method: 'POST',
        url: 'http://example.com',
        queryParams: [],
        headers: [],
        auth: { type: 'none' },
        body: { type: 'json', content: '{"name": "test"}' },
        timeoutMs: 5000,
      };
      const headers = resolveHeaders(req, {});
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('cURL Generation', () => {
    it('produces valid cURL with method, headers, and body', () => {
      const req: ApiRequest = {
        id: '5',
        method: 'POST',
        url: '{{baseUrl}}/api/users',
        queryParams: [{ key: 'active', value: 'true', enabled: true }],
        headers: [{ key: 'X-Trace-Id', value: 't-123', enabled: true }],
        auth: { type: 'bearer', token: 'tok_abc' },
        body: { type: 'json', content: '{"role":"admin"}' },
        timeoutMs: 5000,
      };
      const curl = generateCurlCommand(req, { baseUrl: 'http://localhost:3000' });
      expect(curl).toContain('curl -X POST');
      expect(curl).toContain('"http://localhost:3000/api/users?active=true"');
      expect(curl).toContain('-H "X-Trace-Id: t-123"');
      expect(curl).toContain('-H "Authorization: Bearer tok_abc"');
      expect(curl).toContain('-H "Content-Type: application/json"');
      expect(curl).toContain('-d "{\\"role\\":\\"admin\\"}"');
    });
  });

  describe('Real HTTP Execution', () => {
    it('executes a GET request with query params and headers against real local server', async () => {
      const req: ApiRequest = {
        id: 'req_get',
        method: 'GET',
        url: `${baseUrl}/api/echo`,
        queryParams: [{ key: 'category', value: 'electronics', enabled: true }],
        headers: [{ key: 'X-Custom-Header', value: 'tester-val', enabled: true }],
        auth: { type: 'none' },
        body: { type: 'none', content: '' },
        timeoutMs: 5000,
      };

      const res = await executeApiRequest(req);
      expect(res.status).toBe(200);
      expect(res.durationMs).toBeGreaterThanOrEqual(0);
      expect(res.headers['x-custom-echo']).toBe('tester-val');
      const parsed = JSON.parse(res.body);
      expect(parsed.method).toBe('GET');
      expect(parsed.query).toEqual({ category: 'electronics' });
    });

    it('executes a POST request with JSON body and Basic auth', async () => {
      const req: ApiRequest = {
        id: 'req_post',
        method: 'POST',
        url: `${baseUrl}/api/echo`,
        queryParams: [],
        headers: [],
        auth: { type: 'basic', username: 'bob', password: 'secretpassword' },
        body: { type: 'json', content: '{"title":"Test Item","score":99}' },
        timeoutMs: 5000,
      };

      const res = await executeApiRequest(req);
      expect(res.status).toBe(200);
      expect(res.headers['x-auth-echo']).toBe(`Basic ${btoa('bob:secretpassword')}`);
      const parsed = JSON.parse(res.body);
      expect(parsed.method).toBe('POST');
      expect(parsed.body).toEqual({ title: 'Test Item', score: 99 });
    });

    it('sends strict JSON when the body was written as a JS-style literal', async () => {
      const req: ApiRequest = {
        id: 'req_lenient',
        method: 'POST',
        url: `${baseUrl}/api/echo`,
        queryParams: [],
        headers: [],
        auth: { type: 'none' },
        body: { type: 'json', content: "{ // note\n  name: 'Ann', tags: ['a',], }" },
        timeoutMs: 5000,
      };
      const res = await executeApiRequest(req);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).body).toEqual({ name: 'Ann', tags: ['a'] });
    });

    it('catches and reports invalid JSON before network transmission', async () => {
      const req: ApiRequest = {
        id: 'req_bad_json',
        method: 'POST',
        url: `${baseUrl}/api/echo`,
        queryParams: [],
        headers: [],
        auth: { type: 'none' },
        body: { type: 'json', content: '{"invalid": json syntax' },
        timeoutMs: 5000,
      };

      const res = await executeApiRequest(req);
      expect(res.status).toBe(0);
      expect(res.error).toContain('Invalid JSON body');
    });

    it('handles 500 error responses from server correctly', async () => {
      const req: ApiRequest = {
        id: 'req_500',
        method: 'GET',
        url: `${baseUrl}/api/error`,
        queryParams: [],
        headers: [],
        auth: { type: 'none' },
        body: { type: 'none', content: '' },
        timeoutMs: 5000,
      };

      const res = await executeApiRequest(req);
      expect(res.status).toBe(500);
      const parsed = JSON.parse(res.body);
      expect(parsed.error).toBe('Internal Server Error');
    });

    it('respects timeout configuration and cancels in-flight request', async () => {
      const req: ApiRequest = {
        id: 'req_timeout',
        method: 'GET',
        url: `${baseUrl}/api/slow`,
        queryParams: [],
        headers: [],
        auth: { type: 'none' },
        body: { type: 'none', content: '' },
        timeoutMs: 100, // lower than server's 500ms delay
      };

      const res = await executeApiRequest(req);
      expect(res.status).toBe(0);
      expect(res.error).toMatch(/timed out|aborted/i);
    });

    it('respects external cancellation signal', async () => {
      const controller = new AbortController();
      const req: ApiRequest = {
        id: 'req_cancel',
        method: 'GET',
        url: `${baseUrl}/api/slow`,
        queryParams: [],
        headers: [],
        auth: { type: 'none' },
        body: { type: 'none', content: '' },
        timeoutMs: 5000,
      };

      setTimeout(() => controller.abort(new Error('User aborted request')), 50);
      const res = await executeApiRequest(req, {}, controller.signal);
      expect(res.status).toBe(0);
      expect(res.error).toMatch(/aborted|User aborted request/i);
    });

    it('truncates responses exceeding maxBytes limit', async () => {
      const req: ApiRequest = {
        id: 'req_trunc',
        method: 'GET',
        url: `${baseUrl}/api/large`,
        queryParams: [],
        headers: [],
        auth: { type: 'none' },
        body: { type: 'none', content: '' },
        timeoutMs: 5000,
      };

      // Set max limit to 10KB while server returns 50KB
      const res = await executeApiRequest(req, {}, undefined, 10 * 1024);
      expect(res.status).toBe(200);
      expect(res.sizeBytes).toBe(50 * 1024);
      expect(res.truncated).toBe(true);
      expect(res.body.length).toBe(10 * 1024);
    });
  });
});

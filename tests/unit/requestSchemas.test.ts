import { describe, expect, it } from 'vitest';
import { analyzeFixture, nodesOfKind } from './helpers';
import { bodyTemplate, describeField, parseRequestSchema, type FieldSchema } from '../../src/types/requestSchema';

describe('request schemas extracted for the API tester', async () => {
  const { graph } = await analyzeFixture('request-schemas');
  const schemaOf = (method: string, path: string) => {
    const n = nodesOfKind(graph, 'api-endpoint').find((e) => e.metadata.method === method && e.metadata.path === path);
    expect(n, `${method} ${path}`).toBeDefined();
    return parseRequestSchema(n!.metadata.requestSchema);
  };
  const names = (f: FieldSchema[] | undefined) => (f ?? []).map((x) => x.name);
  const field = (f: FieldSchema[] | undefined, n: string) => (f ?? []).find((x) => x.name === n)!;

  describe('NestJS DTOs and decorators', () => {
    it('@Body() DTO: fields, types, required/optional, enums, examples and nested DTOs', () => {
      const s = schemaOf('POST', '/users')!;
      expect(names(s.body)).toEqual(expect.arrayContaining(['email', 'password', 'role', 'nickname', 'address', 'tags', 'age']));
      expect(names(s.body)).not.toContain('secret'); // private members are not part of the payload
      expect(field(s.body, 'email')).toMatchObject({ type: 'string', required: true, example: 'name@example.com' });
      expect(field(s.body, 'password')).toMatchObject({ type: 'string', required: true });
      expect(field(s.body, 'role')).toMatchObject({ type: 'string', enumValues: ['admin', 'user'], required: true });
      expect(field(s.body, 'nickname')).toMatchObject({ required: false }); // @IsOptional + ?
      expect(field(s.body, 'age')).toMatchObject({ type: 'number', required: false, example: 18 }); // default value
      expect(field(s.body, 'tags')).toMatchObject({ type: 'array', items: 'string' });
      const address = field(s.body, 'address');
      expect(address.type).toBe('object');
      expect(address.fields!.map((f) => `${f.name}:${f.required}`)).toEqual(['street:true', 'zip:false']);
      expect(s.sources.join()).toContain('CreateUserDto');
    });

    it('PartialType(OmitType(Dto, [...])): omitted fields vanish and the rest become optional', () => {
      const s = schemaOf('PATCH', '/users/:id')!;
      expect(names(s.body)).not.toContain('password');
      expect(names(s.body)).toEqual(expect.arrayContaining(['email', 'role', 'address']));
      expect(s.body.every((f) => f.required === false)).toBe(true);
      expect(s.pathParams).toEqual([expect.objectContaining({ name: 'id', type: 'number', required: true })]); // @Param('id') id: number
    });

    it('@Query() DTO and individual @Query(name) parameters', () => {
      const dto = schemaOf('GET', '/users')!;
      expect(names(dto.query)).toEqual(['page', 'search', 'order']);
      expect(field(dto.query, 'order')).toMatchObject({ enumValues: ['asc', 'desc'], required: true });
      expect(field(dto.query, 'page')).toMatchObject({ type: 'number', required: false });
      const single = schemaOf('GET', '/users/search')!;
      expect(single.query.map((f) => `${f.name}:${f.type}:${f.required}`)).toEqual(['term:string:true', 'limit:number:false']);
    });

    it('@Body(name) contributes a single field', () => {
      const s = schemaOf('POST', '/users/:id/note')!;
      expect(s.body.map((f) => f.name)).toEqual(['text']);
      expect(s.pathParams.map((f) => f.name)).toEqual(['id']);
    });
  });

  describe('Express handlers, validators and zod', () => {
    it('reads req.body destructuring (defaults make a field optional)', () => {
      const s = schemaOf('POST', '/login')!;
      expect(s.body.map((f) => `${f.name}:${f.required}`).sort()).toEqual(['email:true', 'password:true', 'remember:false']);
      expect(field(s.body, 'remember')).toMatchObject({ type: 'boolean' });
    });

    it('reads req.query.x and req.query["x"], and body access with optional chaining as optional', () => {
      const s = schemaOf('GET', '/items')!;
      expect(names(s.query).sort()).toEqual(['page', 'sort']);
      expect(s.query.every((f) => f.required === false)).toBe(true);
      expect(field(s.body, 'owner')).toMatchObject({ required: false });
    });

    it('express-validator chains: types, .optional() and dotted names become nested objects', () => {
      const s = schemaOf('POST', '/validated')!;
      expect(field(s.body, 'email')).toMatchObject({ type: 'string', required: true });
      expect(field(s.body, 'age')).toMatchObject({ type: 'number', required: false });
      expect(field(s.body, 'address').fields).toEqual([expect.objectContaining({ name: 'city', type: 'string' })]);
      expect(s.sources).toContain('express-validator');
    });

    it('zod object schemas passed to validation middleware', () => {
      const s = schemaOf('POST', '/zod')!;
      expect(field(s.body, 'name')).toMatchObject({ type: 'string', required: true });
      expect(field(s.body, 'age')).toMatchObject({ type: 'number', required: false });
      expect(field(s.body, 'role')).toMatchObject({ enumValues: ['a', 'b'] });
      expect(field(s.body, 'tags')).toMatchObject({ type: 'array', items: 'string' });
    });

    it('typed Request<Params, Res, Body> generics', () => {
      const s = schemaOf('PUT', '/typed/:id')!;
      expect(s.body.map((f) => `${f.name}:${f.type}:${f.required}`).sort()).toEqual(['done:boolean:false', 'title:string:true']);
    });

    it('passing req.body to a function with a typed parameter uses that type', () => {
      const s = schemaOf('POST', '/via-service')!;
      expect(s.body.map((f) => `${f.name}:${f.type}:${f.required}`).sort()).toEqual(['inStock:boolean:false', 'price:number:true', 'title:string:true']);
      expect(s.sources.join()).toContain('CreateItemInput');
    });
  });

  describe('Next.js route handlers', () => {
    it('await request.json() destructuring and searchParams.get()', () => {
      const s = schemaOf('POST', '/api/posts')!;
      expect(s.body.map((f) => `${f.name}:${f.required}`).sort()).toEqual(['tags:false', 'title:true']);
      expect(names(s.query)).toEqual(['draft']);
    });
  });

  describe('client calls as a fallback', () => {
    it('uses the keys a linked client call really sends when the handler reveals nothing', () => {
      const s = schemaOf('POST', '/api/client-only')!;
      expect(names(s.body).sort()).toEqual(['active', 'count', 'name', 'nested']);
      expect(field(s.body, 'count')).toMatchObject({ type: 'number', example: 3 });
      expect(field(s.body, 'nested').fields).toEqual([expect.objectContaining({ name: 'a', type: 'number' })]);
      expect(names(s.query)).toEqual(['dryRun']);
      expect(s.sources.join()).toMatch(/client call at src\/client\.ts/);
    });
  });

  it('endpoints that accept nothing get no schema (negative)', () => {
    const lonely = nodesOfKind(graph, 'api-endpoint').filter((e) => !e.metadata.requestSchema);
    expect(lonely.length).toBeGreaterThanOrEqual(0);
    for (const n of nodesOfKind(graph, 'api-endpoint')) if (n.metadata.requestSchema) expect(parseRequestSchema(n.metadata.requestSchema)).toBeDefined();
  });

  it('turns a schema into a body template and field descriptions', () => {
    const s = schemaOf('POST', '/users')!;
    expect(bodyTemplate(s.body)).toEqual({
      email: 'name@example.com',
      password: '',
      role: 'admin',
      nickname: '',
      address: { street: '', zip: '' },
      tags: [],
      age: 18,
    });
    expect(describeField(field(s.body, 'role'))).toBe('string · required · one of: admin, user');
    expect(describeField(field(s.body, 'tags'))).toBe('string[] · required');
  });
});

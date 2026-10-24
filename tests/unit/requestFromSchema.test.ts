import { describe, expect, it } from 'vitest';
import { analyzeFixture, nodesOfKind } from './helpers';
import { requestFromSchema } from '../../webview/src/state/store';
import { parseRequestSchema } from '../../src/types/requestSchema';

describe('pre-filling the API tester from an endpoint schema', async () => {
  const { graph } = await analyzeFixture('request-schemas');
  const schema = (m: string, p: string) => parseRequestSchema(nodesOfKind(graph, 'api-endpoint').find((e) => e.metadata.method === m && e.metadata.path === p)!.metadata.requestSchema);

  it('lists path variables, enables required query params, switches optional ones off, and builds a JSON body', () => {
    const r = requestFromSchema('GET', '/users', schema('GET', '/users'));
    expect(r.queryParams.map((q) => `${q.key}:${q.enabled}`)).toEqual(['page:false', 'search:false', 'order:true']);
    expect(r.queryParams.find((q) => q.key === 'order')).toMatchObject({ value: 'asc', description: 'string · required · one of: asc, desc' });
    expect(r.body).toEqual({ type: 'none', content: '' }); // GET never carries a body

    const patch = requestFromSchema('PATCH', '/users/:id', schema('PATCH', '/users/:id'));
    expect(patch.pathParams).toEqual([expect.objectContaining({ key: 'id', value: '', description: 'number · required' })]);
    expect(patch.body.type).toBe('json');
    const body = JSON.parse(patch.body.content);
    expect(Object.keys(body).sort()).toEqual(['address', 'age', 'email', 'nickname', 'role', 'tags']);
    expect(body.address).toEqual({ street: '', zip: '' });
    expect(patch.body.content).toContain('\n  "email"'); // pretty-printed
  });

  it('endpoints with no known schema still list their path variables and nothing else', () => {
    const r = requestFromSchema('DELETE', '/things/:thingId/parts/:partId', undefined);
    expect(r.pathParams?.map((p) => p.key)).toEqual(['thingId', 'partId']);
    expect(r.queryParams).toEqual([]);
    expect(r.body).toEqual({ type: 'none', content: '' });
  });
});

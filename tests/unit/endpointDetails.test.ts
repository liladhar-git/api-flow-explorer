import { describe, expect, it } from 'vitest';
import { analyzeFixture, nodesOfKind } from './helpers';

describe('endpoint details for the details panel', async () => {
  const { graph } = await analyzeFixture('endpoint-details');
  const ep = (m: string, p: string) => nodesOfKind(graph, 'api-endpoint').find((e) => e.metadata.method === m && e.metadata.path === p)!;

  it('NestJS: handler, controller, guards, interceptors, module and @ApiOperation description', () => {
    const e = ep('POST', '/:singularName/:id/actions/publish');
    expect(e.metadata).toMatchObject({
      handler: 'publish',
      controller: 'EntryController',
      guards: ['AuthGuard', 'PermissionsGuard'],
      interceptors: ['TransformInterceptor'],
      module: 'EntryModule',
      description: 'Publish an entry by singular name and ID.',
    });
  });

  it('JSDoc: only the first paragraph is used', () => {
    expect(ep('POST', '/:singularName/:id/remove').metadata.description).toBe('Remove an entry.');
  });

  it('Express: JSDoc description, handler, controller object and route middleware', () => {
    expect(ep('GET', '/widgets').metadata).toMatchObject({ handler: 'listWidgets', description: 'Lists every widget visible to the caller.', middleware: ['auth'] });
    expect(ep('GET', '/widgets').metadata.controller).toBeUndefined(); // a plain function has no controller
    expect(ep('POST', '/widgets').metadata).toMatchObject({ handler: 'create', controller: 'widgetController', description: 'Create a widget.' });
  });

  it('endpoints without guards or docs simply omit those fields (negative)', () => {
    const m = ep('POST', '/widgets').metadata;
    expect(m.guards).toBeUndefined();
    expect(m.interceptors).toBeUndefined();
    expect(m.module).toBeUndefined();
  });
});

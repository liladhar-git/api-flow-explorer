import type { FileFacts } from '../types/analyzer';
import { emptySchema, mergeFields, mergeSchemas, pathParamNames, serializeSchema, type FieldSchema, type RequestSchema } from '../types/requestSchema';
import type { LinkContext } from './adapters/shared/adapter';

/**
 * Attaches the request schema to every endpoint node (`metadata.requestSchema`, JSON). Sources, strongest first:
 * what adapters read from the route/decorators (DTOs, validators, zod), what the handler function reads from its
 * request, and — only for parts still unknown — the keys that client calls linked to the endpoint actually send.
 */
export function applyRequestSchemas(link: LinkContext): void {
  const { graph, facts } = link;
  const usage = new Map<string, RequestSchema>();
  const clients = new Map<string, { bodyFields?: FieldSchema[]; queryFields?: FieldSchema[]; path: string; line: number }>();
  for (const f of facts.values() as Iterable<FileFacts>) {
    for (const [id, s] of Object.entries(f.requestUsage ?? {})) usage.set(id, s);
    for (const r of f.requests) if (r.bodyFields || r.queryFields) clients.set(r.id, { bodyFields: r.bodyFields, queryFields: r.queryFields, path: f.path, line: r.line });
  }

  const handlers = new Map<string, string[]>();
  const callers = new Map<string, { id: string; strong: boolean }[]>();
  for (const e of graph.allEdges()) {
    if (e.kind === 'handles-route') (handlers.get(e.source) ?? handlers.set(e.source, []).get(e.source)!).push(e.target);
    else if (e.kind === 'http-request' && e.resolution !== 'unresolved') {
      (callers.get(e.target) ?? callers.set(e.target, []).get(e.target)!).push({ id: e.source, strong: e.confidence !== 'low' });
    }
  }

  for (const node of graph.allNodes()) {
    if (node.kind !== 'api-endpoint') continue;
    const declared = link.schemas.get(node.id);
    const fromHandlers = (handlers.get(node.id) ?? []).sort().map((h) => usage.get(h));
    let schema = mergeSchemas(declared, ...fromHandlers);

    // client calls only fill in what the backend side did not reveal
    if (!schema.body.length || !schema.query.length) {
      const hit = (callers.get(node.id) ?? [])
        .filter((c) => c.strong)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((c) => clients.get(c.id))
        .find((c) => c && ((!schema.body.length && c.bodyFields?.length) || (!schema.query.length && c.queryFields?.length)));
      if (hit) {
        const add = emptySchema();
        if (!schema.body.length) add.body = hit.bodyFields ?? [];
        if (!schema.query.length) add.query = hit.queryFields ?? [];
        add.sources.push(`client call at ${hit.path}:${hit.line}`);
        schema = mergeSchemas(schema, add);
      }
    }

    // path params always come from the route itself; a typed declaration (e.g. @Param('id') id: number) refines them
    const names = pathParamNames(String(node.metadata.path ?? ''));
    const fromPath: FieldSchema[] = names.map((name) => ({ name, type: 'string', required: true }));
    const typedParams = schema.pathParams.filter((p) => names.includes(p.name));
    schema.pathParams = mergeFields(typedParams, fromPath).sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name)).map((p) => ({ ...p, required: true }));

    const text = serializeSchema(schema);
    if (text) node.metadata = { ...node.metadata, requestSchema: text };
  }
}

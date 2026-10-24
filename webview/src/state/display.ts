import type { Category, GraphNode, NodeKind } from '../types/view';

/** Human names for node kinds, as shown on cards and in the details panel. */
export const KIND_NAME: Record<NodeKind, string> = {
  'frontend-page': 'Page',
  'frontend-component': 'Component',
  'api-client': 'Request',
  'api-endpoint': 'API Endpoint',
  route: 'Router',
  middleware: 'Middleware',
  guard: 'Guard',
  interceptor: 'Interceptor',
  controller: 'Controller',
  service: 'Service',
  function: 'Function',
  repository: 'Repository',
  model: 'Model',
  database: 'Database',
  queue: 'Queue',
  'external-api': 'External API',
  unknown: 'Unresolved',
};

export const CATEGORY_NAME: Record<Category, string> = { frontend: 'Frontend', api: 'API', backend: 'Backend', data: 'Data', external: 'External', unknown: 'Unresolved' };

/** File name and line, e.g. "entry.controller.ts:122". */
export function fileLabel(n: GraphNode): string {
  if (!n.path) return n.metadata.external ? 'external' : '';
  return n.startLine ? `${n.path}:${n.startLine}` : n.path;
}

export const methodOf = (n: GraphNode): string | undefined => {
  const m = n.kind === 'api-endpoint' || n.kind === 'api-client' ? String(n.metadata.method ?? '') : '';
  return m && m !== 'UNKNOWN' ? m : undefined;
};

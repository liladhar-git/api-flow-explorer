import type { SidebarGroups, SidebarItem } from '../messaging/sidebarMessages';
import type { Graph, GraphNode } from '../types/graph';

const LIMIT = 4000;

const item = (n: GraphNode, name: string): SidebarItem => ({ id: n.id, name, sub: n.path ? `${n.path}${n.startLine ? `:${n.startLine}` : ''}` : String(n.metadata.origin ?? '') });

/** Secondary sidebar groups: frontend requests, services, models and external APIs (each capped; search narrows them). */
export function sidebarGroups(graph: Graph): SidebarGroups {
  const out: SidebarGroups = { requests: [], services: [], models: [], externals: [] };
  for (const n of graph.nodes) {
    if (n.kind === 'api-client' && out.requests.length < LIMIT) out.requests.push(item(n, n.name));
    else if (n.kind === 'service' && out.services.length < LIMIT) out.services.push(item(n, n.qualifiedName ?? n.name));
    else if (n.kind === 'model' && out.models.length < LIMIT) out.models.push(item(n, n.name));
    else if (n.kind === 'external-api' && out.externals.length < LIMIT) out.externals.push(item(n, n.name));
  }
  for (const g of Object.values(out)) g.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

import type { EndpointSummary } from '../../../src/types/graph';
import type { Filters, GraphEdge, GraphNode } from '../types/view';

export function nodePasses(n: GraphNode, f: Filters, focusId?: string): boolean {
  if (n.id === focusId) return true;
  if (f.hiddenKinds.has(n.kind)) return false;
  if (n.kind === 'api-endpoint') {
    if (f.methods.size && !f.methods.has(String(n.metadata.method))) return false;
    if (f.frameworks.size && !f.frameworks.has(String(n.metadata.framework))) return false;
  }
  return true;
}

/** Applies user filters to a subgraph. Edges disappear with their endpoints. */
export function applyFilters(nodes: GraphNode[], edges: GraphEdge[], f: Filters, focusId?: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const keep = new Set(nodes.filter((n) => nodePasses(n, f, focusId)).map((n) => n.id));
  return {
    nodes: nodes.filter((n) => keep.has(n.id)),
    edges: edges.filter(
      (e) => keep.has(e.source) && keep.has(e.target) && !f.hiddenConfidence.has(e.confidence) && !(f.hideUnresolved && e.resolution === 'unresolved'),
    ),
  };
}

export function countEdges(edges: GraphEdge[], nodeId: string): { incoming: Record<string, number>; outgoing: Record<string, number>; inTotal: number; outTotal: number } {
  const incoming: Record<string, number> = {};
  const outgoing: Record<string, number> = {};
  let inTotal = 0;
  let outTotal = 0;
  for (const e of edges) {
    if (e.target === nodeId) {
      incoming[e.kind] = (incoming[e.kind] ?? 0) + 1;
      inTotal++;
    }
    if (e.source === nodeId) {
      outgoing[e.kind] = (outgoing[e.kind] ?? 0) + 1;
      outTotal++;
    }
  }
  return { incoming, outgoing, inTotal, outTotal };
}

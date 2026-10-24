import type { EdgeKind, GraphEdge, GraphNode } from '../types/view';

/** Wording on edges and in the trace: reads as "A handled by B", "B calls C". */
export const EDGE_LABEL: Record<EdgeKind, string> = {
  calls: 'calls',
  imports: 'imports',
  renders: 'renders',
  'http-request': 'requests',
  'handles-route': 'handled by',
  'mounts-router': 'mounts',
  'uses-middleware': 'uses',
  'uses-guard': 'guarded by',
  injects: 'injects',
  reads: 'reads',
  writes: 'writes',
  publishes: 'publishes to',
  subscribes: 'consumed by',
  returns: 'returns',
};

export interface TraceStep {
  index: number;
  from: GraphNode;
  to: GraphNode;
  edge: GraphEdge;
  label: string;
}

const FLOW_KINDS = new Set<EdgeKind>(['http-request', 'handles-route', 'calls', 'uses-middleware', 'uses-guard', 'reads', 'writes', 'publishes', 'subscribes', 'renders', 'injects']);

/**
 * Static call path from a node: the flow the source describes (request → endpoint → handler → services → data), listed in
 * breadth-first order. It is derived from the analysis, not recorded at runtime, so it shows what *can* happen.
 */
export function buildTrace(nodes: GraphNode[], edges: GraphEdge[], startId: string | undefined, limit = 14): TraceStep[] {
  if (!startId) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, GraphEdge[]>();
  for (const e of edges) if (FLOW_KINDS.has(e.kind)) (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e);
  for (const list of out.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  const steps: TraceStep[] = [];
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length && steps.length < limit) {
    const id = queue.shift()!;
    for (const e of out.get(id) ?? []) {
      const from = byId.get(e.source);
      const to = byId.get(e.target);
      if (!from || !to) continue;
      steps.push({ index: steps.length + 1, from, to, edge: e, label: EDGE_LABEL[e.kind] });
      if (!seen.has(to.id)) {
        seen.add(to.id);
        queue.push(to.id);
      }
      if (steps.length >= limit) break;
    }
  }
  return steps;
}

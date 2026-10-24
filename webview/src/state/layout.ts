import dagre from '@dagrejs/dagre';
import type { GraphEdge, GraphNode, LayoutDirection } from '../types/view';

export const NODE_WIDTH = 250;
export const NODE_HEIGHT = 88;

/** Layered left-to-right layout (request → endpoint → handler → data). Pure: positions only, no rendering concerns. */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], direction: LayoutDirection): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 34, ranksep: 130, marginx: 24, marginy: 24, ranker: 'network-simplex' });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target) && e.source !== e.target) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(n.id);
    out.set(n.id, { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 });
  }
  return out;
}

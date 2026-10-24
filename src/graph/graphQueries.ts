import type { EndpointSummary, Graph, GraphEdge, GraphNode } from '../types/graph';
import { DOWNSTREAM_KINDS, traverse, UPSTREAM_KINDS } from './graphTraversal';

/** Indexed, read-only view over a graph. Build once per analysis and reuse for every query. */
export class GraphIndex {
  readonly nodes = new Map<string, GraphNode>();
  readonly edges = new Map<string, GraphEdge>();
  readonly outgoing = new Map<string, GraphEdge[]>();
  readonly incoming = new Map<string, GraphEdge[]>();

  constructor(readonly graph: Graph) {
    for (const n of graph.nodes) this.nodes.set(n.id, n);
    for (const e of graph.edges) {
      this.edges.set(e.id, e);
      (this.outgoing.get(e.source) ?? this.outgoing.set(e.source, []).get(e.source)!).push(e);
      (this.incoming.get(e.target) ?? this.incoming.set(e.target, []).get(e.target)!).push(e);
    }
  }

  out(id: string): GraphEdge[] {
    return this.outgoing.get(id) ?? [];
  }

  in(id: string): GraphEdge[] {
    return this.incoming.get(id) ?? [];
  }
}

export function listEndpoints(graph: Graph): EndpointSummary[] {
  return graph.nodes
    .filter((n) => n.kind === 'api-endpoint')
    .map((n) => ({
      id: n.id,
      method: String(n.metadata.method ?? 'ALL'),
      path: String(n.metadata.path ?? '/'),
      framework: String(n.metadata.framework ?? 'unknown'),
      file: n.path ?? '',
      line: n.startLine ?? 1,
    }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.file.localeCompare(b.file));
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export const MAX_VIEW_NODES = 300;

export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Number of edges leading to/from nodes that are not in this view, per node: the basis for expand buttons. */
  hidden: Record<string, { up: number; down: number }>;
  truncated: boolean;
}

/** The nodes plus every edge between them, with counts of edges that leave the view. */
export function inducedSubgraph(index: GraphIndex, ids: Set<string>, truncated = false): Subgraph {
  const nodes: GraphNode[] = [];
  const hidden: Subgraph['hidden'] = {};
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  for (const id of [...ids].sort()) {
    const n = index.nodes.get(id);
    if (!n) continue;
    nodes.push(n);
    let up = 0;
    let down = 0;
    for (const e of index.in(id)) {
      if (ids.has(e.source)) {
        if (!seenEdges.has(e.id)) {
          seenEdges.add(e.id);
          edges.push(e);
        }
      } else up++;
    }
    for (const e of index.out(id)) {
      if (ids.has(e.target)) {
        if (!seenEdges.has(e.id)) {
          seenEdges.add(e.id);
          edges.push(e);
        }
      } else down++;
    }
    if (up || down) hidden[id] = { up, down };
  }
  return { nodes, edges, hidden, truncated };
}

/** Endpoint-centric view: callers/requests upstream, handlers/services/data stores downstream. */
export function focusView(index: GraphIndex, nodeId: string, depth = 3): Subgraph | undefined {
  if (!index.nodes.has(nodeId)) return undefined;
  const down = traverse(index, [nodeId], { direction: 'downstream', depth, kinds: DOWNSTREAM_KINDS, maxNodes: MAX_VIEW_NODES });
  const up = traverse(index, [nodeId], { direction: 'upstream', depth, kinds: UPSTREAM_KINDS, maxNodes: MAX_VIEW_NODES });
  const ids = new Set<string>([...down.nodes, ...up.nodes]);
  return inducedSubgraph(index, ids, down.truncated || up.truncated);
}

/** Grows a view by one step in one direction, following every edge kind. */
export function expandView(index: GraphIndex, visible: Set<string>, nodeId: string, direction: 'upstream' | 'downstream', depth = 1): Subgraph {
  const grown = traverse(index, [nodeId], { direction, depth, maxNodes: MAX_VIEW_NODES });
  const ids = new Set<string>([...visible, ...grown.nodes]);
  return inducedSubgraph(index, ids, grown.truncated || ids.size >= MAX_VIEW_NODES * 2);
}

export { searchEndpoints, type EndpointFilter } from './endpointSearch';

/** Innermost code symbol whose source range contains the given 1-based line of a workspace-relative file. */
export function nodeAtPosition(index: GraphIndex, relPath: string, line: number): GraphNode | undefined {
  let best: GraphNode | undefined;
  let bestSpan = Infinity;
  for (const n of index.nodes.values()) {
    if (n.path !== relPath || n.startLine === undefined) continue;
    const end = n.endLine ?? n.startLine;
    if (line < n.startLine || line > end) continue;
    if (n.id.endsWith('#<module>')) continue; // synthetic whole-file owner
    const span = end - n.startLine;
    if (span < bestSpan) {
      best = n;
      bestSpan = span;
    }
  }
  return best;
}

/** Incoming relationships (who calls / renders / routes to / requests this node), with their evidence. */
export function referencesTo(index: GraphIndex, nodeId: string): { edge: GraphEdge; from: GraphNode }[] {
  return index
    .in(nodeId)
    .flatMap((edge) => {
      const from = index.nodes.get(edge.source);
      return from ? [{ edge, from }] : [];
    })
    .sort((a, b) => a.edge.evidence.path.localeCompare(b.edge.evidence.path) || a.edge.evidence.line - b.edge.evidence.line);
}

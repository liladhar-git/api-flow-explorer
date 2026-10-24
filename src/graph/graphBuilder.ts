import type { Evidence, Graph, GraphEdge, GraphNode, NodeKind } from '../types/graph';
import { GRAPH_SCHEMA_VERSION } from '../types/graph';
import { edgeId } from './ids';

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

type EdgeInput = Omit<GraphEdge, 'id'> & { id?: string };

/** Accumulates nodes and edges, merging duplicates deterministically. */
export class GraphBuilder {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  /** Adds a node; when the ID already exists, keeps the existing one and merges new metadata keys. */
  addNode(node: Omit<GraphNode, 'metadata'> & { metadata?: GraphNode['metadata'] }): GraphNode {
    const existing = this.nodes.get(node.id);
    if (existing) {
      existing.metadata = { ...(node.metadata ?? {}), ...existing.metadata };
      // a declaration site is better evidence than a usage site
      if (!existing.path && node.path) {
        existing.path = node.path;
        existing.startLine = node.startLine;
        existing.endLine = node.endLine;
        existing.startColumn = node.startColumn;
      }
      return existing;
    }
    const created: GraphNode = { ...node, metadata: node.metadata ?? {} };
    this.nodes.set(node.id, created);
    return created;
  }

  setKind(id: string, kind: NodeKind, metadata?: GraphNode['metadata']): void {
    const n = this.nodes.get(id);
    if (!n) return;
    n.kind = kind;
    if (metadata) n.metadata = { ...n.metadata, ...metadata };
  }

  /** Adds an edge. Edges between the same endpoints with the same kind merge: the strongest confidence wins, earliest evidence is kept. */
  addEdge(input: EdgeInput): GraphEdge {
    const id = input.id ?? edgeId(input.kind, input.source, input.target);
    const edge: GraphEdge = { ...input, id };
    const existing = this.edges.get(id);
    if (!existing) {
      this.edges.set(id, edge);
      return edge;
    }
    if (CONFIDENCE_RANK[edge.confidence] > CONFIDENCE_RANK[existing.confidence]) {
      existing.confidence = edge.confidence;
      existing.resolution = edge.resolution;
      existing.reason = edge.reason;
    }
    if (compareEvidence(edge.evidence, existing.evidence) < 0) existing.evidence = edge.evidence;
    return existing;
  }

  allNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  allEdges(): GraphEdge[] {
    return [...this.edges.values()];
  }

  edgeCount(): number {
    return this.edges.size;
  }

  build(): Graph {
    const nodes = [...this.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const edges = [...this.edges.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges };
  }
}

function compareEvidence(a: Evidence, b: Evidence): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return a.line - b.line;
}

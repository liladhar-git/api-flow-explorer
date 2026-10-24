import { GraphSchema, type Graph } from '../types/graph';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Structural validation (Zod) plus referential integrity: unique IDs, no dangling edge endpoints. */
export function validateGraph(input: unknown): ValidationResult {
  const parsed = GraphSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  return validateReferences(parsed.data);
}

export function validateReferences(graph: Graph): ValidationResult {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  for (const n of graph.nodes) {
    if (nodeIds.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    nodeIds.add(n.id);
    if (n.startLine !== undefined && n.endLine !== undefined && n.endLine < n.startLine) errors.push(`node ${n.id}: endLine < startLine`);
  }
  const edgeIds = new Set<string>();
  for (const e of graph.edges) {
    if (edgeIds.has(e.id)) errors.push(`duplicate edge id: ${e.id}`);
    edgeIds.add(e.id);
    if (!nodeIds.has(e.source)) errors.push(`edge ${e.id}: dangling source ${e.source}`);
    if (!nodeIds.has(e.target)) errors.push(`edge ${e.id}: dangling target ${e.target}`);
  }
  return { ok: errors.length === 0, errors };
}

/** Defensive repair used by the analyzer: drops edges whose endpoints do not exist. Returns the number dropped. */
export function dropDanglingEdges(graph: Graph): number {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const before = graph.edges.length;
  graph.edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return before - graph.edges.length;
}

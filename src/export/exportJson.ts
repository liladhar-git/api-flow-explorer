import type { Graph } from '../types/graph';
import { GraphSchema } from '../types/graph';

/** Complete normalized graph. Nodes and edges are already id-sorted, so output is byte-stable between runs. No source text is included. */
export function exportJson(graph: Graph): string {
  return JSON.stringify(GraphSchema.parse(graph), null, 2) + '\n';
}

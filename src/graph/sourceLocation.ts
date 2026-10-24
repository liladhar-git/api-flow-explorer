import * as path from 'node:path';
import type { GraphEdge, GraphNode } from '../types/graph';
import type { GraphIndex } from './graphQueries';

export interface SourceLocation {
  /** Absolute path, guaranteed inside `root`. */
  file: string;
  line: number;
  column: number;
}

function inside(root: string, rel: string): string | undefined {
  const abs = path.resolve(root, rel);
  return abs === root || abs.startsWith(root + path.sep) ? abs : undefined;
}

export function locationOfNode(index: GraphIndex, root: string, nodeId: string): SourceLocation | undefined {
  const n: GraphNode | undefined = index.nodes.get(nodeId);
  if (!n?.path) return undefined;
  const file = inside(root, n.path);
  return file ? { file, line: n.startLine ?? 1, column: n.startColumn ?? 1 } : undefined;
}

export function locationOfEdge(index: GraphIndex, root: string, edgeId: string): SourceLocation | undefined {
  const e: GraphEdge | undefined = index.edges.get(edgeId);
  if (!e) return undefined;
  const file = inside(root, e.evidence.path);
  return file ? { file, line: e.evidence.line, column: 1 } : undefined;
}

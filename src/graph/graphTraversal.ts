import type { EdgeKind } from '../types/graph';
import type { GraphIndex } from './graphQueries';

export type Direction = 'upstream' | 'downstream';

/** Edge kinds followed by default. Edges point in execution flow: request → endpoint → handler → service → data. */
export const DOWNSTREAM_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>([
  'http-request', 'handles-route', 'uses-middleware', 'uses-guard', 'calls', 'renders', 'reads', 'writes', 'publishes', 'subscribes', 'mounts-router',
]);
export const UPSTREAM_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(['http-request', 'handles-route', 'calls', 'renders', 'publishes', 'subscribes', 'mounts-router']);

export interface TraversalOptions {
  direction: Direction;
  depth: number;
  /** undefined = every edge kind */
  kinds?: ReadonlySet<EdgeKind>;
  maxNodes?: number;
}

export interface TraversalResult {
  nodes: Set<string>;
  truncated: boolean;
}

/** Breadth-first walk so nearer nodes win when `maxNodes` truncates the result. Cycles are safe. */
export function traverse(index: GraphIndex, starts: string[], opts: TraversalOptions): TraversalResult {
  const maxNodes = opts.maxNodes ?? Infinity;
  const seen = new Set<string>();
  let truncated = false;
  let frontier: string[] = [];
  for (const s of starts) {
    if (index.nodes.has(s)) {
      seen.add(s);
      frontier.push(s);
    }
  }
  for (let d = 0; d < opts.depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      const edges = opts.direction === 'downstream' ? index.out(id) : index.in(id);
      for (const e of edges) {
        if (opts.kinds && !opts.kinds.has(e.kind)) continue;
        const other = opts.direction === 'downstream' ? e.target : e.source;
        if (seen.has(other)) continue;
        if (seen.size >= maxNodes) {
          truncated = true;
          continue;
        }
        seen.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return { nodes: seen, truncated };
}

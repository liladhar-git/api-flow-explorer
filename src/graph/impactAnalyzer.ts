import type { Confidence, EdgeKind, GraphEdge, GraphNode } from '../types/graph';
import { CONFIDENCE_RANK, weakestConfidence } from '../analyzer/confidence';
import type { GraphIndex } from './graphQueries';

export interface ImpactPath {
  /** Node ids from the affected node down to the changed node. */
  nodes: string[];
  edges: GraphEdge[];
  /** Weakest confidence along the path. */
  confidence: Confidence;
  /** True when every edge on the path is resolved (no inferred/unresolved hop). */
  certain: boolean;
}

export interface ImpactItem {
  node: GraphNode;
  distance: number;
  path: ImpactPath;
}

export interface ImpactReport {
  target: GraphNode;
  /** API endpoints whose execution can reach the target. */
  endpoints: ImpactItem[];
  /** Frontend request call sites that hit an affected endpoint. */
  requests: ImpactItem[];
  /** Pages/components that (transitively) issue those requests or render the target. */
  frontend: ImpactItem[];
  /** Everything else that depends on the target (callers, services, middleware...). */
  dependents: ImpactItem[];
  /** What the target itself touches: data stores and queues (forward dependencies). */
  dependencies: GraphNode[];
  truncated: boolean;
}

/**
 * Reverse-dependency analysis: "if this symbol changes, what can be affected?". Walks edges backwards from the target
 * (callers, handlers, endpoints, requests, components) with a shortest-path explanation for every affected node.
 * This is a static over-approximation: reachable in the call graph does not mean executed at runtime.
 */
export function analyzeImpact(index: GraphIndex, targetId: string, opts: { minConfidence?: Confidence; maxNodes?: number; skipKinds?: ReadonlySet<EdgeKind> } = {}): ImpactReport | undefined {
  const target = index.nodes.get(targetId);
  if (!target) return undefined;
  const maxNodes = opts.maxNodes ?? 2000;
  const min = CONFIDENCE_RANK[opts.minConfidence ?? 'low'];

  const parent = new Map<string, { via: GraphEdge; next: string }>();
  const distance = new Map<string, number>([[targetId, 0]]);
  let frontier = [targetId];
  let truncated = false;
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of index.in(id)) {
        if (CONFIDENCE_RANK[e.confidence] < min || opts.skipKinds?.has(e.kind)) continue;
        if (distance.has(e.source)) continue;
        if (distance.size >= maxNodes) {
          truncated = true;
          continue;
        }
        distance.set(e.source, distance.get(id)! + 1);
        parent.set(e.source, { via: e, next: id });
        next.push(e.source);
      }
    }
    frontier = next;
  }

  const pathFor = (id: string): ImpactPath => {
    const nodes = [id];
    const edges: GraphEdge[] = [];
    let cur = id;
    while (cur !== targetId) {
      const p = parent.get(cur)!;
      edges.push(p.via);
      nodes.push(p.next);
      cur = p.next;
    }
    return { nodes, edges, confidence: weakestConfidence(edges.map((e) => e.confidence)), certain: edges.every((e) => e.resolution === 'resolved') };
  };

  const items: ImpactItem[] = [];
  for (const [id, d] of distance) {
    if (id === targetId) continue;
    const node = index.nodes.get(id);
    if (node) items.push({ node, distance: d, path: pathFor(id) });
  }
  items.sort((a, b) => a.distance - b.distance || a.node.id.localeCompare(b.node.id));

  const report: ImpactReport = { target, endpoints: [], requests: [], frontend: [], dependents: [], dependencies: [], truncated };
  for (const it of items) {
    const k = it.node.kind;
    if (k === 'api-endpoint') report.endpoints.push(it);
    else if (k === 'api-client') report.requests.push(it);
    else if (k === 'frontend-page' || k === 'frontend-component') report.frontend.push(it);
    else report.dependents.push(it);
  }

  const seen = new Set<string>();
  for (const e of index.out(targetId)) {
    const n = index.nodes.get(e.target);
    if (n && ['model', 'database', 'queue', 'external-api'].includes(n.kind) && !seen.has(n.id)) {
      seen.add(n.id);
      report.dependencies.push(n);
    }
  }
  return report;
}

export function formatImpact(report: ImpactReport): string {
  const lines: string[] = [];
  const loc = (n: GraphNode) => (n.path ? ` (${n.path}:${n.startLine ?? 1})` : '');
  lines.push(`Impact of changing ${report.target.qualifiedName ?? report.target.name}${loc(report.target)}`);
  const section = (title: string, list: ImpactItem[]) => {
    if (!list.length) return;
    lines.push('', `${title} (${list.length})`);
    for (const it of list) lines.push(`  - ${it.node.name}${loc(it.node)} · ${it.distance} hop(s) · ${it.path.confidence}${it.path.certain ? '' : ', via inferred/unresolved edge'}`);
  };
  section('API endpoints', report.endpoints);
  section('Frontend requests', report.requests);
  section('Pages and components', report.frontend);
  section('Other dependents', report.dependents);
  if (report.dependencies.length) lines.push('', `Touches: ${report.dependencies.map((d) => d.name).join(', ')}`);
  if (report.truncated) lines.push('', 'Result truncated: the dependent set is very large.');
  lines.push('', 'Static analysis: reachable means a call path exists in source, not that it executes at runtime.');
  return lines.join('\n');
}

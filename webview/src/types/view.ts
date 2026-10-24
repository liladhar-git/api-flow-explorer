import type { Confidence, EdgeKind, GraphEdge, GraphNode, NodeKind } from '../../../src/types/graph';

export type Category = 'frontend' | 'api' | 'backend' | 'data' | 'external' | 'unknown';

export const CATEGORY_OF: Record<NodeKind, Category> = {
  'frontend-page': 'frontend',
  'frontend-component': 'frontend',
  'api-client': 'frontend',
  'api-endpoint': 'api',
  route: 'api',
  middleware: 'backend',
  guard: 'backend',
  interceptor: 'backend',
  controller: 'backend',
  service: 'backend',
  function: 'backend',
  repository: 'backend',
  model: 'data',
  database: 'data',
  queue: 'data',
  'external-api': 'external',
  unknown: 'unknown',
};

/** Plain functions are classified by the side of the stack their file is on (set by the analyzer). */
export function categoryOf(node: GraphNode): Category {
  if (node.kind === 'function' && node.metadata.layer === 'frontend') return 'frontend';
  return CATEGORY_OF[node.kind];
}

export interface Filters {
  hiddenKinds: Set<NodeKind>;
  hiddenConfidence: Set<Confidence>;
  /** Empty set = all. Applies to endpoint nodes and the endpoint list. */
  methods: Set<string>;
  frameworks: Set<string>;
  hideUnresolved: boolean;
}

export const emptyFilters = (): Filters => ({ hiddenKinds: new Set(), hiddenConfidence: new Set(), methods: new Set(), frameworks: new Set(), hideUnresolved: false });

export interface Selection {
  type: 'node' | 'edge';
  id: string;
}

export type LayoutDirection = 'LR' | 'TB';
export type { Confidence, EdgeKind, GraphEdge, GraphNode, NodeKind };

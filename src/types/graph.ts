import { z } from 'zod';
import { EDGE_KINDS, NODE_KINDS } from './kinds';

export { EDGE_KINDS, NODE_KINDS };

export const NodeKindSchema = z.enum(NODE_KINDS);
export type NodeKind = z.infer<typeof NodeKindSchema>;

export const EdgeKindSchema = z.enum(EDGE_KINDS);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ResolutionSchema = z.enum(['resolved', 'inferred', 'unresolved']);
export type Resolution = z.infer<typeof ResolutionSchema>;

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ALL'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

const relativePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(p) && !p.split('/').includes('..'), {
    message: 'path must be workspace-relative',
  });

/**
 * Metadata is deliberately a loose record: each kind documents its own keys in docs/graph-schema.md.
 * Values are restricted to JSON primitives and arrays of primitives so graphs stay serializable.
 */
const metaValue = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number(), z.boolean()]))]);
export const MetadataSchema = z.record(z.string(), metaValue);
export type Metadata = z.infer<typeof MetadataSchema>;

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: NodeKindSchema,
  name: z.string().min(1),
  qualifiedName: z.string().optional(),
  path: relativePath.optional(),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  startColumn: z.number().int().min(1).optional(),
  metadata: MetadataSchema.default({}),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const EvidenceSchema = z.object({
  path: relativePath,
  line: z.number().int().min(1),
  explanation: z.string().min(1),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  kind: EdgeKindSchema,
  evidence: EvidenceSchema,
  confidence: ConfidenceSchema,
  resolution: ResolutionSchema,
  /** Why an edge is not fully resolved (unknown base URL, dynamic path, ...). */
  reason: z.string().optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GRAPH_SCHEMA_VERSION = 1;

export const GraphSchema = z.object({
  schemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});
export type Graph = z.infer<typeof GraphSchema>;

export type { EndpointSummary } from './endpointSummary';

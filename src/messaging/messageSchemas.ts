import { z } from 'zod';
import { EndpointSummarySchema } from './endpointSummarySchema';
import { FilterStateSchema } from './filterStateSchema';
import { GraphEdgeSchema, GraphNodeSchema } from '../types/graph';
import { ApiRequestSchema, ApiResponseSchema } from '../types/apiTest';

/** Messages the webview may send. Anything not matching is dropped by the host. */
export const WebviewToHostSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('requestScan') }),
  z.object({ type: z.literal('listEndpoints') }),
  z.object({ type: z.literal('focus'), nodeId: z.string().min(1).max(2000), depth: z.number().int().min(1).max(8).default(3) }),
  z.object({
    type: z.literal('expand'),
    nodeId: z.string().min(1).max(2000),
    direction: z.enum(['upstream', 'downstream']),
    depth: z.number().int().min(1).max(4).default(1),
  }),
  /** The webview only ever names graph IDs, never file paths. */
  z.object({ type: z.literal('openNode'), nodeId: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('openEvidence'), edgeId: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('exportMermaid'), nodeIds: z.array(z.string().max(2000)).max(5000) }),
  /** Whole-graph exports; the host decides what to write and where (a save dialog), the page only picks the format. */
  z.object({ type: z.literal('exportAction'), action: z.enum(['markdown', 'json']) }),
  z.object({ type: z.literal('setFilters'), filters: FilterStateSchema }),
  /** One base URL for every API in the tester; remembered per workspace. */
  z.object({ type: z.literal('setBaseUrl'), value: z.string().max(2000) }),
  // API Testing
  z.object({
    type: z.literal('executeRequest'),
    request: ApiRequestSchema,
    environmentVariables: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('cancelRequest'),
    requestId: z.string(),
  }),
]);
export type WebviewToHost = z.infer<typeof WebviewToHostSchema>;


export const HostToWebviewSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state'),
    hasAnalysis: z.boolean(),
    scanning: z.boolean(),
    stats: z
      .object({ files: z.number(), nodes: z.number(), edges: z.number(), endpoints: z.number(), unresolved: z.number(), diagnostics: z.number() })
      .optional(),
    progress: z.string().optional(),
  }),
  z.object({ type: z.literal('endpoints'), endpoints: z.array(EndpointSummarySchema) }),
  z.object({
    type: z.literal('subgraph'),
    nodes: z.array(GraphNodeSchema),
    edges: z.array(GraphEdgeSchema),
    focusId: z.string().optional(),
    /** Per-node count of edges not currently shown, keyed by node id. */
    hidden: z.record(z.string(), z.object({ up: z.number(), down: z.number() })),
    truncated: z.boolean(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('filters'), filters: FilterStateSchema }),
  z.object({ type: z.literal('baseUrl'), value: z.string() }),
  // API Testing
  z.object({
    type: z.literal('requestStarted'),
    requestId: z.string(),
  }),
  z.object({
    type: z.literal('requestFinished'),
    response: ApiResponseSchema,
  }),
  z.object({
    type: z.literal('requestCancelled'),
    requestId: z.string(),
  }),
]);
export type HostToWebview = z.infer<typeof HostToWebviewSchema>;

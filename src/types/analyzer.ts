import type { AnalysisDiagnostic } from './diagnostics';
import type { Graph } from './graph';

export interface AnalyzerOptions {
  /** Absolute workspace root. */
  root: string;
  /** Extra directory names to ignore. */
  ignoredDirectories: string[];
  includeTests: boolean;
  maxFiles: number;
  /** Static values for environment variables used in request base URLs. */
  baseUrls: Record<string, string>;
  /** Absolute cache directory; undefined disables persistence. */
  cacheDir?: string;
  /** Ignore the cache and reanalyze everything. */
  fullRescan?: boolean;
}

export interface CancellationLike {
  readonly isCancellationRequested: boolean;
}

export interface ScanProgress {
  phase: 'discover' | 'parse' | 'link' | 'validate' | 'done';
  message: string;
  done?: number;
  total?: number;
}

export interface ScanReport {
  root: string;
  filesDiscovered: number;
  filesAnalyzed: number;
  filesFromCache: number;
  filesRemoved: number;
  filesSkipped: { path: string; reason: string }[];
  frameworks: string[];
  packages: { name: string; dir: string }[];
  nodeCounts: Record<string, number>;
  edgeCounts: Record<string, number>;
  unresolvedEdges: number;
  diagnostics: AnalysisDiagnostic[];
  durationMs: number;
  /** Where the time went, in milliseconds. */
  timingsMs?: { scan: number; hash: number; parse: number; link: number; cacheLoad: number; cacheSave: number };
  cancelled: boolean;
}

export interface AnalysisResult {
  graph: Graph;
  report: ScanReport;
}

// ---------------------------------------------------------------------------
// Per-file facts. Everything here is JSON-serializable so it can be cached.
// ---------------------------------------------------------------------------
import type { Confidence, GraphEdge, GraphNode, Metadata, NodeKind, Resolution } from './graph';
import type { FieldSchema, RequestSchema } from './requestSchema';

export interface HolePart {
  /** Source text (truncated) of the unresolved expression. */
  hole: string;
  reason: 'env' | 'param' | 'expr';
  env?: string;
  /** Parameter index of the enclosing function when reason === 'param'. */
  param?: number;
  /** Value used when an env hole is not configured (e.g. `process.env.X ?? 'http://localhost'`). */
  fallback?: StrPart[];
}
export type StrPart = string | HolePart;
/** A statically evaluated string: literal pieces interleaved with unresolved holes. */
export type StaticString = StrPart[];

export interface SymbolDecl {
  id: string;
  name: string;
  qualified: string;
  kind: NodeKind;
  line: number;
  endLine: number;
  column: number;
  exported: boolean;
  meta: Metadata;
}

export interface CallFact {
  from: string;
  to: string;
  line: number;
  callKind: 'call' | 'new' | 'render';
  confidence: Confidence;
  resolution: Resolution;
  explanation: string;
  /** Statically evaluated string arguments by position (null when not a string-like expression). Used for API wrapper propagation. */
  args?: (StaticString | null)[];
}

export interface RequestFact {
  id: string;
  owner: string;
  line: number;
  column: number;
  library: 'fetch' | 'axios';
  /** Keys the call site sends (object literal / typed argument); fallback request schema for the endpoint it hits. */
  bodyFields?: FieldSchema[];
  queryFields?: FieldSchema[];
  method?: StaticString;
  url: StaticString;
  /** axios instance baseURL. */
  base?: StaticString;
  execution: 'client' | 'server' | 'unknown';
  /** Source text of the call for display. */
  text: string;
}

export interface HandlerRef {
  /** Resolved symbol id when the handler could be traced to a workspace declaration. */
  id?: string;
  text: string;
  line: number;
  note?: string;
}

export interface ExpressFacts {
  routers: { id: string; name: string; line: number; column: number; kind: 'app' | 'router' }[];
  routes: { router: string; methods: string[]; path: StaticString; line: number; handlers: HandlerRef[]; middleware: HandlerRef[]; /** From express-validator chains / zod validation middleware on the route. */ schema?: RequestSchema }[];
  uses: { router: string; path?: StaticString; line: number; middleware: HandlerRef[]; mount?: { routerId?: string; text: string } }[];
}

export interface NestRouteFact {
  method: string;
  path: StaticString;
  methodId: string;
  methodName: string;
  line: number;
  guards: HandlerRef[];
  interceptors: HandlerRef[];
  schema?: RequestSchema;
}

export interface NestClassFact {
  id: string;
  name: string;
  line: number;
  controllerPath?: StaticString;
  isController: boolean;
  guards: HandlerRef[];
  interceptors: HandlerRef[];
  routes: NestRouteFact[];
}

export interface NestFacts {
  classes: NestClassFact[];
  globalPrefix?: StaticString;
  modules?: { id: string; name: string; line: number; controllers: string[]; providers: string[] }[];
}

export interface FileFacts {
  path: string;
  hash: string;
  /** Workspace files whose content influenced this file's facts (for incremental invalidation). */
  deps: string[];
  /** The file imports something that could not be resolved; re-analyzed when files are added. */
  hasUnresolved: boolean;
  boundary: 'client' | 'server' | 'unknown';
  symbols: SymbolDecl[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  calls: CallFact[];
  requests: RequestFact[];
  express?: ExpressFacts;
  nest?: NestFacts;
  /** Request schema inferred from how each handler function reads its request, keyed by symbol id. */
  requestUsage?: Record<string, RequestSchema>;
  diagnostics: AnalysisDiagnostic[];
  /** Number of call expressions whose target could not be resolved to a workspace symbol. */
  unresolvedCalls: number;
}

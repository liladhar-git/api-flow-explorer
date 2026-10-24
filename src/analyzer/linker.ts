import type { AnalyzerOptions, FileFacts, SymbolDecl } from '../types/analyzer';
import type { AnalysisDiagnostic } from '../types/diagnostics';
import type { Graph } from '../types/graph';
import { GraphBuilder } from '../graph/graphBuilder';
import { dropDanglingEdges, validateReferences } from '../graph/graphValidator';
import { packageOf, type WorkspaceMeta } from '../scanner/packageDiscovery';
import type { FrameworkAdapter, LinkContext } from './adapters/shared/adapter';
import { linkRequests } from './endpointMatcher';
import { enrichEndpoints } from './endpointDetails';
import { applyRequestSchemas } from './requestSchemas';
import type { RequestSchema } from '../types/requestSchema';

export interface LinkResult {
  graph: Graph;
  diagnostics: AnalysisDiagnostic[];
}

/**
 * Merges per-file facts into the canonical graph. Runs over all files each time (cheap, no parsing):
 * adapter link steps resolve cross-file structure, then the call graph and request matching are layered on top.
 */
export function linkFacts(facts: Map<string, FileFacts>, options: AnalyzerOptions, meta: WorkspaceMeta, adapters: FrameworkAdapter[]): LinkResult {
  const graph = new GraphBuilder();
  const diagnostics: AnalysisDiagnostic[] = [];
  const registry = new Map<string, SymbolDecl & { path: string }>();
  for (const f of facts.values()) for (const s of f.symbols) registry.set(s.id, { ...s, path: f.path });

  const ensureSymbol = (id: string): boolean => {
    if (graph.hasNode(id)) return true;
    const s = registry.get(id);
    if (!s) return false;
    graph.addNode({
      id: s.id,
      kind: s.kind,
      name: s.name,
      qualifiedName: s.qualified,
      path: s.path,
      startLine: s.line,
      endLine: s.endLine,
      startColumn: s.column,
      metadata: { ...s.meta, exported: s.exported },
    });
    return true;
  };

  const link: LinkContext = {
    facts,
    options,
    graph,
    diagnostics,
    packageDirOf: (p) => packageOf(meta, p)?.dir ?? '',
    ensureSymbol,
    schemas: new Map<string, RequestSchema>(),
  };

  // 1. nodes and edges that adapters produced directly while parsing a file
  for (const f of facts.values()) {
    for (const n of f.nodes) graph.addNode(n);
    for (const d of f.diagnostics) diagnostics.push(d); // not push(...x): spreading huge arrays overflows the stack
  }
  // 2. cross-file structure (router mounting, NestJS prefixes)
  for (const a of adapters) a.link?.(link);
  // 3. file-local edges whose endpoints exist
  for (const f of facts.values()) {
    for (const e of f.edges) {
      if (ensureSymbol(e.source) && ensureSymbol(e.target)) graph.addEdge(e);
      else if (graph.hasNode(e.source) && graph.hasNode(e.target)) graph.addEdge(e);
    }
  }
  // 4. call graph
  for (const f of facts.values()) {
    for (const c of f.calls) {
      if (!ensureSymbol(c.from) || !ensureSymbol(c.to)) continue;
      graph.addEdge({
        source: c.from,
        target: c.to,
        kind: c.callKind === 'render' ? 'renders' : 'calls',
        evidence: { path: f.path, line: c.line, explanation: c.explanation },
        confidence: c.confidence,
        resolution: c.resolution,
      });
    }
  }
  // 5. frontend requests → endpoints
  linkRequests(link);
  // 5b. what each endpoint accepts (path/query/body), for the API tester
  applyRequestSchemas(link);
  // 5c. handler, controller, guards, module and description for the details panel
  enrichEndpoints(link);

  // 6. classified classes and components are part of the graph even without edges; classified methods only when referenced
  for (const s of registry.values()) if (s.kind !== 'function' && (s.meta.symbolType === 'class' || s.kind === 'frontend-component' || s.kind === 'frontend-page')) ensureSymbol(s.id);

  const built = graph.build();
  const dropped = dropDanglingEdges(built);
  if (dropped > 0) diagnostics.push({ severity: 'warning', code: 'internal', message: `${dropped} edge(s) with missing endpoints were dropped` });
  const check = validateReferences(built);
  if (!check.ok) diagnostics.push({ severity: 'error', code: 'internal', message: `graph validation: ${check.errors.slice(0, 3).join('; ')}` });
  return { graph: built, diagnostics };
}

import type { FileFacts } from '../../../types/analyzer';
import type { AnalysisDiagnostic } from '../../../types/diagnostics';
import type { GraphBuilder } from '../../../graph/graphBuilder';
import type { FileContext } from '../../fileContext';
import type { AnalyzerOptions } from '../../../types/analyzer';
import type { RequestSchema } from '../../../types/requestSchema';

export interface LinkContext {
  facts: Map<string, FileFacts>;
  options: AnalyzerOptions;
  graph: GraphBuilder;
  diagnostics: AnalysisDiagnostic[];
  /** package directory of a file ('' for root) */
  packageDirOf(path: string): string;
  /** Request schemas discovered by adapters while linking, keyed by endpoint id; merged with handler usage afterwards. */
  schemas: Map<string, RequestSchema>;
  /** Adds the graph node for a code symbol from the declaration registry; false if the symbol is unknown. */
  ensureSymbol(id: string): boolean;
}

/**
 * A framework adapter turns source syntax into canonical facts/nodes/edges.
 * `extract` runs per file (cacheable); `link` runs once over all files for cross-file concerns (router mounting,
 * global prefixes, request/endpoint matching) and emits canonical nodes and edges only.
 */
export interface FrameworkAdapter {
  name: string;
  extract(ctx: FileContext): void;
  link?(ctx: LinkContext): void;
}

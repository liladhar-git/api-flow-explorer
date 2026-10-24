/**
 * The one filter state shared by the sidebar and the graph page (the host relays it between them).
 * Plain data, no schema library: the sidebar bundle imports this directly.
 */
export type Category = 'all' | 'frontend' | 'backend';
export type ConfidenceFilter = 'high' | 'medium' | 'low' | 'unresolved';

export interface FilterState {
  /** Free text for the sidebar list (method, path, file, name). */
  query: string;
  /** Frontend = endpoints served by the frontend app (Next.js routes); Backend = everything else. */
  category: Category;
  /** Empty = all. */
  methods: string[];
  /** Empty = all. */
  frameworks: string[];
  hiddenKinds: string[];
  hiddenConfidence: ConfidenceFilter[];
}

export const defaultFilterState = (): FilterState => ({ query: '', category: 'all', methods: [], frameworks: [], hiddenKinds: [], hiddenConfidence: [] });

export const CONFIDENCE_LEVELS: ConfidenceFilter[] = ['high', 'medium', 'low', 'unresolved'];

export function isFiltered(f: FilterState): boolean {
  return !!f.query.trim() || f.category !== 'all' || f.methods.length > 0 || f.frameworks.length > 0 || f.hiddenKinds.length > 0 || f.hiddenConfidence.length > 0;
}

/** Frontend endpoints are the ones implemented by the frontend framework (Next.js route handlers / API routes). */
export const categoryOfEndpoint = (framework: string): Exclude<Category, 'all'> => (framework === 'nextjs' ? 'frontend' : 'backend');

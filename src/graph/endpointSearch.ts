import { categoryOfEndpoint, type Category } from '../types/filterState';
import type { EndpointSummary } from '../types/endpointSummary';

export interface EndpointFilter {
  query?: string;
  methods?: string[];
  frameworks?: string[];
  category?: Category;
}

/** Space-separated terms must all match somewhere in "METHOD path framework file" (so `post auth` narrows to POST auth routes). */
export function searchEndpoints(endpoints: EndpointSummary[], f: EndpointFilter): EndpointSummary[] {
  const terms = (f.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return endpoints.filter((e) => {
    if (f.methods?.length && !f.methods.includes(e.method)) return false;
    if (f.frameworks?.length && !f.frameworks.includes(e.framework)) return false;
    if (f.category && f.category !== 'all' && categoryOfEndpoint(e.framework) !== f.category) return false;
    const hay = `${e.method} ${e.path} ${e.framework} ${e.file}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

import type { EndpointSummary } from '../types/endpointSummary';
import { CONFIDENCE_LEVELS, type FilterState } from '../types/filterState';
import type { HostToSidebar, SidebarGroups, SidebarItem } from './sidebarMessages';

/**
 * Dependency-free checks of host → sidebar messages. The sidebar bundle stays small because it does not ship Zod;
 * `tests/unit/sidebar.test.ts` asserts these accept exactly what the Zod schemas accept.
 */
const isStr = (v: unknown): v is string => typeof v === 'string';
const strArray = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && x.length <= 500);

export function parseFilterState(v: unknown): FilterState | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const f = v as Record<string, unknown>;
  if (!isStr(f.query) || f.query.length > 500 || !['all', 'frontend', 'backend'].includes(f.category as string)) return undefined;
  if (!strArray(f.methods, 12) || !strArray(f.frameworks, 24) || !strArray(f.hiddenKinds, 24)) return undefined;
  if (!Array.isArray(f.hiddenConfidence) || f.hiddenConfidence.length > 4 || !f.hiddenConfidence.every((c) => (CONFIDENCE_LEVELS as string[]).includes(c as string))) return undefined;
  return f as unknown as FilterState;
}

const items = (v: unknown): v is SidebarItem[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null && isStr((x as SidebarItem).id) && isStr((x as SidebarItem).name) && isStr((x as SidebarItem).sub));

function groups(v: unknown): SidebarGroups | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const g = v as Record<string, unknown>;
  return items(g.requests) && items(g.services) && items(g.models) && items(g.externals) ? (g as unknown as SidebarGroups) : undefined;
}

export function parseHostToSidebar(data: unknown): HostToSidebar | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const m = data as Record<string, unknown>;
  if (m.type === 'focusSearch') return { type: 'focusSearch' };
  if (m.type === 'filters') {
    const filters = parseFilterState(m.filters);
    return filters ? { type: 'filters', filters } : undefined;
  }
  if (m.type !== 'state' || typeof m.hasAnalysis !== 'boolean' || typeof m.scanning !== 'boolean' || !Array.isArray(m.endpoints)) return undefined;
  const g = groups(m.groups);
  const filters = parseFilterState(m.filters);
  if (!g || !filters) return undefined;
  for (const e of m.endpoints) {
    if (typeof e !== 'object' || e === null) return undefined;
    const r = e as Record<string, unknown>;
    if (!isStr(r.id) || !isStr(r.method) || !isStr(r.path) || !isStr(r.framework) || !isStr(r.file) || typeof r.line !== 'number') return undefined;
  }
  return { type: 'state', hasAnalysis: m.hasAnalysis, scanning: m.scanning, endpoints: m.endpoints as EndpointSummary[], groups: g, filters };
}

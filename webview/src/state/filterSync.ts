import { CONFIDENCE_LEVELS, type FilterState } from '../../../src/types/filterState';
import type { Confidence, Filters, NodeKind } from '../types/view';

/** Shared (host-relayed) filter state → the sets the graph filtering code uses. */
export function toFilters(f: FilterState): Filters {
  return {
    hiddenKinds: new Set(f.hiddenKinds as NodeKind[]),
    hiddenConfidence: new Set(f.hiddenConfidence.filter((c): c is Confidence => c !== 'unresolved')),
    methods: new Set(f.methods),
    frameworks: new Set(f.frameworks),
    hideUnresolved: f.hiddenConfidence.includes('unresolved'),
  };
}

export const confidenceLevels = CONFIDENCE_LEVELS;

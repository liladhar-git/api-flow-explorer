import type { FilterState } from '../../../src/types/filterState';
import { FiltersForm } from '../shared/FiltersForm';
import { IconClose } from '../shared/icons';
import type { TraceStep } from '../state/trace';
import { Legend } from './Legend';
import { TraceList } from './TraceList';

export type DockTab = 'filters' | 'legend' | 'trace';

export interface BottomDockProps {
  open: boolean;
  tab: DockTab;
  filters: FilterState;
  methods: string[];
  frameworks: string[];
  trace: TraceStep[];
  onChangeFilters(f: FilterState): void;
  onDock(change: { open?: boolean; tab?: DockTab }): void;
  onOpenEvidence(edgeId: string): void;
}

/** Number of filter groups narrowing the graph (badge on the Filters tab). */
export function activeFilterCount(f: FilterState): number {
  return [f.methods.length > 0, f.frameworks.length > 0, f.hiddenKinds.length > 0, f.hiddenConfidence.length > 0].filter(Boolean).length;
}

/** Filters, legend and the static trace under the graph; ✕ collapses it to the tab strip. */
export function BottomDock({ open, tab, filters, methods, frameworks, trace, onChangeFilters, onDock, onOpenEvidence }: BottomDockProps) {
  const active = activeFilterCount(filters);
  const tabs: { id: DockTab; label: string }[] = [
    { id: 'filters', label: 'Filters' },
    { id: 'legend', label: 'Legend' },
    { id: 'trace', label: `Trace Timeline (${trace.length})` },
  ];
  return (
    <section className={`dock${open ? '' : ' collapsed'}`} aria-label="Filters, legend and trace">
      <div className="dock-bar" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={open && tab === t.id} className={`dock-tab${open && tab === t.id ? ' active' : ''}`} onClick={() => onDock({ open: true, tab: t.id })}>
            {t.label}
            {t.id === 'filters' && active > 0 && <span className="dock-badge" title={`${active} filter group(s) active`}>{active}</span>}
          </button>
        ))}
        <span className="dock-spacer" />
        {open && (
          <button className="dock-toggle" aria-label="Collapse panel" title="Collapse panel" onClick={() => onDock({ open: false })}>
            <IconClose />
          </button>
        )}
      </div>
      {open && (
        <div className="dock-body">
          {tab === 'filters' && <FiltersForm layout="row" filters={filters} methods={methods} frameworks={frameworks} onChange={onChangeFilters} />}
          {tab === 'legend' && <Legend />}
          {tab === 'trace' && <TraceList steps={trace} horizontal onOpenEvidence={onOpenEvidence} />}
        </div>
      )}
    </section>
  );
}

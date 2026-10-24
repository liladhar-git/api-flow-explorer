import { NODE_KINDS } from '../../../src/types/kinds';
import { CONFIDENCE_LEVELS, defaultFilterState, isFiltered, type FilterState } from '../../../src/types/filterState';
import { IconReset } from './icons';
import { MultiSelect } from './MultiSelect';

export const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ALL'];
const FRAMEWORK_LABEL: Record<string, string> = { nextjs: 'Next.js', nestjs: 'NestJS', express: 'Express' };
export const frameworkLabel = (f: string) => FRAMEWORK_LABEL[f] ?? f;
const CONFIDENCE_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low', unresolved: 'Unresolved' };
const KIND_LABEL: Record<string, string> = {
  'frontend-page': 'Frontend page', 'frontend-component': 'Frontend component', 'api-client': 'API client request', 'api-endpoint': 'API endpoint', route: 'Router',
  middleware: 'Middleware', guard: 'Guard', interceptor: 'Interceptor', controller: 'Controller', service: 'Service', function: 'Function', repository: 'Repository',
  model: 'Model', database: 'Database', 'external-api': 'External API', queue: 'Queue', unknown: 'Unresolved',
};

export interface FiltersFormProps {
  filters: FilterState;
  /** Methods / frameworks that exist in the analysis (only those are offered). */
  methods: string[];
  frameworks: string[];
  onChange(f: FilterState): void;
  /** `stack` for the sidebar, `row` for the bottom dock. */
  layout?: 'stack' | 'row';
}

const toggle = (list: string[], v: string): string[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/**
 * HTTP method, framework, node type and confidence filters. Methods and frameworks follow the "empty = all" convention in
 * the shared state; the form shows them as checked when the list is empty.
 */
export function FiltersForm({ filters, methods, frameworks, onChange, layout = 'stack' }: FiltersFormProps) {
  const methodOn = (m: string) => filters.methods.length === 0 || filters.methods.includes(m);
  const frameworkOn = (f: string) => filters.frameworks.length === 0 || filters.frameworks.includes(f);
  /** Toggling from the implicit "all" state selects exactly the others; selecting everything again collapses back to "all". */
  const flip = (current: string[], all: string[], value: string): string[] => {
    const effective = current.length === 0 ? all : current;
    const next = toggle(effective, value);
    return next.length === all.length ? [] : next;
  };
  const kinds = NODE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }));
  const shownKinds = NODE_KINDS.filter((k) => !filters.hiddenKinds.includes(k));
  const confidences = CONFIDENCE_LEVELS.map((c) => ({ value: c, label: CONFIDENCE_LABEL[c] }));
  const shownConfidence = CONFIDENCE_LEVELS.filter((c) => !filters.hiddenConfidence.includes(c));

  return (
    <div className={`af-filters af-filters-${layout}`}>
      <fieldset>
        <legend>HTTP Method</legend>
        <div className="af-checks">
          {methods.map((m) => (
            <label key={m} className="af-check">
              <input type="checkbox" checked={methodOn(m)} onChange={() => onChange({ ...filters, methods: flip(filters.methods, methods, m) })} />
              {m}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Framework</legend>
        <div className="af-checks">
          {frameworks.map((f) => (
            <label key={f} className="af-check">
              <input type="checkbox" checked={frameworkOn(f)} onChange={() => onChange({ ...filters, frameworks: flip(filters.frameworks, frameworks, f) })} />
              {frameworkLabel(f)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="af-dropdowns">
        <div>
          <div className="af-label">Node Types</div>
          <MultiSelect label="Node Types" options={kinds} selected={shownKinds} onChange={(sel) => onChange({ ...filters, hiddenKinds: NODE_KINDS.filter((k) => !sel.includes(k)) })} />
        </div>
        <div>
          <div className="af-label">Confidence</div>
          <MultiSelect label="Confidence" options={confidences} selected={shownConfidence} onChange={(sel) => onChange({ ...filters, hiddenConfidence: CONFIDENCE_LEVELS.filter((c) => !sel.includes(c)) })} />
        </div>
      </div>
      <button type="button" className="af-reset" disabled={!isFiltered(filters)} onClick={() => onChange(defaultFilterState())}>
        <IconReset /> Reset Filters
      </button>
    </div>
  );
}

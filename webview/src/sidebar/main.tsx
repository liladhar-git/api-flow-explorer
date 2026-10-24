import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../shared/shared.css';
import './sidebar.css';
import { searchEndpoints } from '../../../src/graph/endpointSearch';
import { parseHostToSidebar } from '../../../src/messaging/sidebarGuards';
import type { SidebarGroups, SidebarItem, SidebarToHost } from '../../../src/messaging/sidebarMessages';
import type { EndpointSummary } from '../../../src/types/endpointSummary';
import { categoryOfEndpoint, defaultFilterState, isFiltered, type Category, type FilterState } from '../../../src/types/filterState';
import { FiltersForm, METHOD_ORDER } from '../shared/FiltersForm';
import { IconChevronDown, IconChevronRight, IconFilter, IconSearch, Logo } from '../shared/icons';

interface VsCodeApi {
  postMessage(m: unknown): void;
  getState(): unknown;
  setState(s: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const api: VsCodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage() {}, getState: () => undefined, setState() {} };
const send = (m: SidebarToHost) => api.postMessage(m);

const MAX_ROWS = 300;
const NO_GROUPS: SidebarGroups = { requests: [], services: [], models: [], externals: [] };

type GroupKey = 'endpoints' | 'requests' | 'services' | 'models' | 'externals';
const GROUPS: { key: GroupKey; title: string; kind: string }[] = [
  { key: 'endpoints', title: 'Endpoints', kind: 'api-endpoint' },
  { key: 'requests', title: 'Frontend Requests', kind: 'api-client' },
  { key: 'services', title: 'Services', kind: 'service' },
  { key: 'models', title: 'Models', kind: 'model' },
  { key: 'externals', title: 'External APIs', kind: 'external-api' },
];

interface Saved {
  open?: Partial<Record<GroupKey, boolean>>;
  filtersOpen?: boolean;
}

function itemMatches(i: SidebarItem, terms: string[]): boolean {
  const hay = `${i.name} ${i.sub}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

function Sidebar() {
  const saved = (api.getState() as Saved | undefined) ?? {};
  const [hasAnalysis, setHasAnalysis] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [endpoints, setEndpoints] = useState<EndpointSummary[]>([]);
  const [groups, setGroups] = useState<SidebarGroups>(NO_GROUPS);
  const [filters, setFilters] = useState<FilterState>(defaultFilterState());
  const [open, setOpen] = useState<Partial<Record<GroupKey, boolean>>>({ endpoints: true, ...saved.open });
  const [filtersOpen, setFiltersOpen] = useState(saved.filtersOpen ?? true);
  const [activeId, setActiveId] = useState<string>();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.setState({ open, filtersOpen } satisfies Saved);
  }, [open, filtersOpen]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const m = parseHostToSidebar(event.data);
      if (!m) return;
      if (m.type === 'state') {
        setHasAnalysis(m.hasAnalysis);
        setScanning(m.scanning);
        setEndpoints(m.endpoints);
        setGroups(m.groups);
        setFilters(m.filters);
      } else if (m.type === 'filters') setFilters(m.filters);
      else if (m.type === 'focusSearch') {
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('message', onMessage);
    send({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /** Every local change goes to the host, which forwards it to the graph page. */
  const update = useCallback((next: FilterState) => {
    setFilters(next);
    send({ type: 'setFilters', filters: next });
  }, []);

  const methods = useMemo(() => METHOD_ORDER.filter((m) => endpoints.some((e) => e.method === m)), [endpoints]);
  const frameworks = useMemo(() => [...new Set(endpoints.map((e) => e.framework))].sort(), [endpoints]);
  const counts = useMemo(() => {
    const c = { all: endpoints.length, frontend: 0, backend: 0 };
    for (const e of endpoints) c[categoryOfEndpoint(e.framework)]++;
    return c;
  }, [endpoints]);

  const terms = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
  const shownEndpoints = useMemo(
    () => (filters.hiddenKinds.includes('api-endpoint') ? [] : searchEndpoints(endpoints, { query: filters.query, methods: filters.methods, frameworks: filters.frameworks, category: filters.category })),
    [endpoints, filters],
  );
  const shown: Record<GroupKey, (EndpointSummary | SidebarItem)[]> = {
    endpoints: shownEndpoints,
    requests: filters.hiddenKinds.includes('api-client') ? [] : groups.requests.filter((i) => itemMatches(i, terms)),
    services: filters.hiddenKinds.includes('service') ? [] : groups.services.filter((i) => itemMatches(i, terms)),
    models: filters.hiddenKinds.includes('model') ? [] : groups.models.filter((i) => itemMatches(i, terms)),
    externals: filters.hiddenKinds.includes('external-api') ? [] : groups.externals.filter((i) => itemMatches(i, terms)),
  };
  const total: Record<GroupKey, number> = { endpoints: endpoints.length, requests: groups.requests.length, services: groups.services.length, models: groups.models.length, externals: groups.externals.length };

  const openEndpoint = (id: string) => {
    setActiveId(id);
    send({ type: 'openEndpoint', id });
  };
  const openItem = (id: string) => {
    setActiveId(id);
    send({ type: 'openItem', id });
  };

  const rows = () => [...(listRef.current?.querySelectorAll<HTMLElement>('.af-row') ?? [])];
  const onListKey = (ev: React.KeyboardEvent) => {
    const list = rows();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      list[Math.min(list.length - 1, i + 1)]?.focus();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (i <= 0) searchRef.current?.focus();
      else list[i - 1].focus();
    } else if (ev.key === 'Enter' && i >= 0) list[i].click();
    else if (ev.key === 'Home') list[0]?.focus();
    else if (ev.key === 'End') list[list.length - 1]?.focus();
  };

  const body = () => {
    if (scanning) return <div className="af-empty">Scanning workspace…</div>;
    if (!hasAnalysis) {
      return (
        <div className="af-empty">
          <p>No analysis yet. Nothing leaves your machine and no code is executed.</p>
          <button className="af-primary" onClick={() => send({ type: 'scan' })}>Scan Workspace</button>
        </div>
      );
    }
    if (endpoints.length === 0 && groups.services.length === 0) return <div className="af-empty">No API endpoints found. Supported: Express, NestJS, Next.js route handlers and API routes.</div>;
    const anything = GROUPS.some((g) => shown[g.key].length > 0);
    return (
      <>
        {GROUPS.map((g) => {
          const list = shown[g.key];
          const isOpen = open[g.key] ?? false;
          const filtered = isFiltered(filters) && list.length !== total[g.key];
          return (
            <section key={g.key} className="af-group" data-group={g.key}>
              <button className="af-group-head" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [g.key]: !isOpen })}>
                {isOpen ? <IconChevronDown /> : <IconChevronRight />}
                <span>{g.title} ({filtered ? `${list.length} of ${total[g.key]}` : total[g.key]})</span>
              </button>
              {isOpen && (
                <ul className="af-list" role="listbox" aria-label={g.title}>
                  {g.key === 'endpoints'
                    ? (list as EndpointSummary[]).slice(0, MAX_ROWS).map((e) => (
                        <li key={e.id} role="option" aria-selected={e.id === activeId} tabIndex={-1} className={`af-row${e.id === activeId ? ' active' : ''}`} data-id={e.id} title={`${e.method} ${e.path}\n${e.framework} · ${e.file}:${e.line}`} onClick={() => openEndpoint(e.id)}>
                          <span className={`af-badge m-${e.method}`}>{e.method}</span>
                          <span className="af-path">{e.path}</span>
                        </li>
                      ))
                    : (list as SidebarItem[]).slice(0, MAX_ROWS).map((i) => (
                        <li key={i.id} role="option" aria-selected={i.id === activeId} tabIndex={-1} className={`af-row item${i.id === activeId ? ' active' : ''}`} data-id={i.id} title={`${i.name}\n${i.sub}`} onClick={() => openItem(i.id)}>
                          <span className="af-item-name">{i.name}</span>
                          <span className="af-item-sub">{i.sub}</span>
                        </li>
                      ))}
                  {list.length > MAX_ROWS && <li className="af-more">Showing the first {MAX_ROWS}. Keep typing to narrow the list.</li>}
                  {list.length === 0 && <li className="af-more">Nothing matches.</li>}
                </ul>
              )}
            </section>
          );
        })}
        {!anything && <div className="af-empty">No results match the search and filters.</div>}
      </>
    );
  };

  return (
    <div className="af-sidebar">
      <header className="af-header">
        <Logo />
        <div>
          <h1>API Flow Explorer</h1>
          <p>Explore API flows across frontend, backend and data systems.</p>
        </div>
      </header>

      <div className="af-searchrow">
        <div className="af-search">
          <span className="af-search-icon"><IconSearch /></span>
          <input
            ref={searchRef}
            type="text"
            value={filters.query}
            placeholder="Search endpoints, files, nodes…"
            aria-label="Search endpoints"
            spellCheck={false}
            onChange={(e) => update({ ...filters, query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                rows()[0]?.focus();
              } else if (e.key === 'Enter') {
                const first = rows()[0];
                if (first) first.click();
              } else if (e.key === 'Escape' && isFiltered(filters)) update(defaultFilterState());
            }}
          />
          {filters.query && (
            <button className="af-clear" aria-label="Clear search" title="Clear search and filters" onClick={() => { update(defaultFilterState()); searchRef.current?.focus(); }}>✕</button>
          )}
        </div>
        <button className={`af-iconbtn${filtersOpen ? ' on' : ''}`} aria-label="Toggle filters" aria-pressed={filtersOpen} title="Show or hide the filters" onClick={() => setFiltersOpen((o) => !o)}>
          <IconFilter />
          {isFiltered({ ...filters, query: '' }) && <span className="af-dot" aria-label="filters active" />}
        </button>
      </div>

      <div className="af-pills" role="group" aria-label="Endpoint category">
        {(['all', 'frontend', 'backend'] as Category[]).map((c) => (
          <button key={c} className={`af-pill${filters.category === c ? ' on' : ''}`} aria-pressed={filters.category === c} onClick={() => update({ ...filters, category: c })}>
            {c === 'all' ? 'All' : c === 'frontend' ? 'Frontend' : 'Backend'} <span className="af-pill-count">{counts[c]}</span>
          </button>
        ))}
      </div>

      <div className="af-scroll" ref={listRef} onKeyDown={onListKey}>{body()}</div>

      {hasAnalysis && filtersOpen && (
        <section className="af-filters-panel" aria-label="Filters">
          <div className="af-filters-head">
            <strong>Filters</strong>
            <button className="af-iconbtn small" aria-label="Collapse filters" onClick={() => setFiltersOpen(false)}><IconChevronDown /></button>
          </div>
          <FiltersForm filters={filters} methods={methods} frameworks={frameworks} onChange={update} />
        </section>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Sidebar />);

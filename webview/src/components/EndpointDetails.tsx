import { parseRequestSchema, type FieldSchema } from '../../../src/types/requestSchema';
import { IconArrowRight, IconClose, IconExpand, IconOpen } from '../shared/icons';
import { CATEGORY_NAME, fileLabel, KIND_NAME, methodOf } from '../state/display';
import type { TraceStep } from '../state/trace';
import { categoryOf, type GraphEdge, type GraphNode, type Selection } from '../types/view';
import { CategoryIcon } from './CategoryIcon';
import { TraceList } from './TraceList';

export interface EndpointRef {
  method: string;
  path: string;
  id: string;
  requestSchema?: string;
}

export interface EndpointDetailsProps {
  selection?: Selection;
  nodes: GraphNode[];
  edges: GraphEdge[];
  hidden: Record<string, { up: number; down: number }>;
  tab: 'details' | 'trace';
  wide: boolean;
  trace: TraceStep[];
  onTab(tab: 'details' | 'trace'): void;
  onClose(): void;
  onToggleWide(): void;
  onOpenNode(id: string): void;
  onOpenEvidence(edgeId: string): void;
  onExpand(id: string, d: 'upstream' | 'downstream'): void;
  onFocus(id: string): void;
  onSelect(s: Selection): void;
  onTestEndpoint?(endpoint: EndpointRef): void;
}

const CONF_TITLE = { high: 'Direct source evidence', medium: 'Inferred from partial evidence', low: 'Weak evidence; verify manually' } as const;
/** Metadata that has its own place in the panel (or is internal) and is not repeated in the generic table. */
const HIDDEN_META = new Set(['requestSchema', 'description', 'symbolType', 'exported', 'anonymous', 'handler', 'controller', 'guards', 'interceptors', 'middleware', 'module', 'method', 'path', 'framework', 'reason', 'layer', 'executes', 'class']);

const list = (v: unknown): string | undefined => (Array.isArray(v) ? (v.length ? v.join(', ') : undefined) : v === undefined || v === null || v === '' ? undefined : String(v));
const FRAMEWORK_NAME: Record<string, string> = { nestjs: 'NestJS', nextjs: 'Next.js', express: 'Express', react: 'React' };

function Chips({ title, fields }: { title: string; fields: FieldSchema[] }) {
  if (!fields.length) return null;
  return (
    <div className="dp-chiprow">
      <span className="dp-chip-title">{title}</span>
      {fields.map((f) => (
        <span key={f.name} className="dp-chip" title={`${f.type}${f.required ? ' · required' : ' · optional'}`}>
          {f.name}
          {!f.required && <i>?</i>}
        </span>
      ))}
    </div>
  );
}

function EdgeRow({ e, other, dir, onOpenEvidence, onSelect }: { e: GraphEdge; other?: GraphNode; dir: 'in' | 'out'; onOpenEvidence(id: string): void; onSelect(s: Selection): void }) {
  return (
    <li className={`edge-row res-${e.resolution}`}>
      <button className="af-link" onClick={() => onSelect({ type: 'edge', id: e.id })} title="Show relationship details">
        {dir === 'in' ? '←' : '→'} <b>{e.kind}</b> {other?.name ?? (dir === 'in' ? e.source : e.target)}
      </button>
      <span className={`pill conf-${e.confidence}`} title={CONF_TITLE[e.confidence]}>{e.confidence}</span>
      <span className="pill">{e.resolution}</span>
      <button className="af-link" onClick={() => onOpenEvidence(e.id)} title={`${e.evidence.path}:${e.evidence.line}`}>
        {e.evidence.path.split('/').pop()}:{e.evidence.line}
      </button>
    </li>
  );
}

function NodeRow({ n, onSelect }: { n: GraphNode; onSelect(s: Selection): void }) {
  const m = methodOf(n);
  const cat = categoryOf(n);
  return (
    <li>
      <button className="dp-noderow" onClick={() => onSelect({ type: 'node', id: n.id })} title={`Select ${n.name}`}>
        <span className={`dp-nodeicon cat-${cat}`}><CategoryIcon category={cat} size={18} /></span>
        <span className="dp-nodetext">
          <span className="dp-nodename">{m && <span className={`af-badge m-${m}`}>{m}</span>} {n.name}</span>
          <span className="dp-nodesub">{CATEGORY_NAME[cat]} · {KIND_NAME[n.kind]}</span>
        </span>
        <IconArrowRight />
      </button>
    </li>
  );
}

export function EndpointDetails(p: EndpointDetailsProps) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const edge = p.selection?.type === 'edge' ? p.edges.find((x) => x.id === p.selection!.id) : undefined;
  const node = p.selection?.type === 'node' ? byId.get(p.selection.id) : undefined;
  const isEndpoint = node?.kind === 'api-endpoint';
  const title = edge ? 'Relationship' : node ? (isEndpoint ? 'Endpoint Details' : `${KIND_NAME[node.kind]} Details`) : 'Details';

  const header = (
    <header className="dp-head">
      <h2>{title}</h2>
      <div className="dp-head-actions">
        <button aria-label={p.wide ? 'Narrow panel' : 'Widen panel'} title={p.wide ? 'Narrow panel' : 'Widen panel'} onClick={p.onToggleWide}><IconExpand /></button>
        <button aria-label="Close details" title="Close details" onClick={p.onClose}><IconClose /></button>
      </div>
    </header>
  );

  if (!p.selection || (!edge && !node)) {
    return (
      <section className="details-panel" aria-label="Details">
        {header}
        <p className="hint dp-pad">Select a node or edge to see its source location, relationships and evidence.</p>
      </section>
    );
  }

  if (edge) {
    return (
      <section className="details-panel" aria-label="Details">
        {header}
        <div className="dp-pad">
          <p className="dp-edgeline">{byId.get(edge.source)?.name} <span className="trace-verb">→</span> {byId.get(edge.target)?.name}</p>
          <p><span className="pill">{edge.kind}</span> <span className={`pill conf-${edge.confidence}`}>{edge.confidence}</span> <span className="pill">{edge.resolution}</span></p>
          <p className="evidence">{edge.evidence.explanation}</p>
          {edge.reason && <p className="reason"><b>Why not fully resolved:</b> {edge.reason}</p>}
          <button className="dp-open" onClick={() => p.onOpenEvidence(edge.id)}><IconOpen /> Open {edge.evidence.path}:{edge.evidence.line}</button>
        </div>
      </section>
    );
  }

  const n = node!;
  const method = methodOf(n);
  const cat = categoryOf(n);
  const hidden = p.hidden[n.id];
  const incoming = p.edges.filter((e) => e.target === n.id);
  const outgoing = p.edges.filter((e) => e.source === n.id);
  const related = [...new Map(outgoing.map((e) => [e.target, byId.get(e.target)])).values()].filter((x): x is GraphNode => !!x).slice(0, 14);
  const callers = [...new Map(incoming.map((e) => [e.source, byId.get(e.source)])).values()].filter((x): x is GraphNode => !!x);
  const schema = parseRequestSchema(n.metadata.requestSchema);
  const reason = typeof n.metadata.reason === 'string' ? n.metadata.reason : undefined;
  const description = typeof n.metadata.description === 'string' ? n.metadata.description : undefined;
  const framework = list(n.metadata.framework);
  const rows: [string, string | undefined][] = isEndpoint
    ? [
        ['Method', list(n.metadata.method)],
        ['Path', list(n.metadata.path)],
        ['Controller', list(n.metadata.controller)],
        ['Handler', list(n.metadata.handler)],
        ['Guards', list(n.metadata.guards)],
        ['Interceptors', list(n.metadata.interceptors)],
        ['Middleware', list(n.metadata.middleware)],
        ['Module', list(n.metadata.module)],
      ]
    : [
        ['Kind', KIND_NAME[n.kind]],
        ['Name', n.qualifiedName && n.qualifiedName !== n.name ? n.qualifiedName : undefined],
        ...Object.entries(n.metadata).filter(([k]) => !HIDDEN_META.has(k)).map(([k, v]): [string, string | undefined] => [k, list(v)]),
      ];
  const endpointRef: EndpointRef | undefined = isEndpoint ? { method: String(n.metadata.method || 'GET'), path: String(n.metadata.path || n.name), id: n.id, requestSchema: typeof n.metadata.requestSchema === 'string' ? n.metadata.requestSchema : undefined } : undefined;

  return (
    <section className="details-panel" aria-label="Details">
      {header}
      <div className="dp-pad">
        <div className="dp-summary">
          {method ? <span className={`af-badge big m-${method}`}>{method}</span> : <span className={`dp-icon cat-${cat}`}><CategoryIcon category={cat} /></span>}
          <div className="dp-summary-text">
            <div className="dp-title" title={n.name}>{isEndpoint ? String(n.metadata.path ?? n.name) : n.name}</div>
            <div className="dp-sub">{KIND_NAME[n.kind]}</div>
          </div>
        </div>

        <dl className="dp-rows">
          {n.path && (<><dt>File</dt><dd title={n.path}>{n.path}</dd></>)}
          {n.startLine !== undefined && (<><dt>Line</dt><dd>{n.startLine}</dd></>)}
          {framework && (<><dt>Framework</dt><dd>{FRAMEWORK_NAME[framework] ?? framework}</dd></>)}
          {list(n.metadata.controller) && (<><dt>Controller</dt><dd>{list(n.metadata.controller)}</dd></>)}
        </dl>
        {!n.path && <p className="hint">No source location (external or synthetic node).</p>}
        <button className="dp-open" disabled={!n.path} onClick={() => p.onOpenNode(n.id)} title={fileLabel(n)}>
          <IconOpen /> Open Source
        </button>

        <div className="dp-tabs" role="tablist">
          <button role="tab" aria-selected={p.tab === 'details'} className={p.tab === 'details' ? 'active' : ''} onClick={() => p.onTab('details')}>Details</button>
          {endpointRef && p.onTestEndpoint && (
            <button role="tab" aria-selected={false} onClick={() => p.onTestEndpoint?.(endpointRef)} title="Open the API Tester for this endpoint">API Tester</button>
          )}
          <button role="tab" aria-selected={p.tab === 'trace'} className={p.tab === 'trace' ? 'active' : ''} onClick={() => p.onTab('trace')}>Trace</button>
        </div>

        {p.tab === 'trace' ? (
          <TraceList steps={p.trace} onOpenEvidence={p.onOpenEvidence} />
        ) : (
          <>
            {reason && <p className="reason"><b>Unresolved:</b> {reason}</p>}
            {description && (
              <>
                <h3>Description</h3>
                <p className="dp-desc">{description}</p>
              </>
            )}
            <h3>Metadata</h3>
            <dl className="dp-meta">
              {rows.filter(([, v]) => v).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
            {schema && (
              <>
                <h3>Accepts</h3>
                <Chips title="Path" fields={schema.pathParams} />
                <Chips title="Query" fields={schema.query} />
                <Chips title="Body" fields={schema.body} />
              </>
            )}

            <div className="dp-actions">
              <button onClick={() => p.onExpand(n.id, 'upstream')} disabled={!hidden?.up}>◂ Expand upstream</button>
              <button onClick={() => p.onExpand(n.id, 'downstream')} disabled={!hidden?.down}>Expand downstream ▸</button>
              <button onClick={() => p.onFocus(n.id)}>Focus here</button>
            </div>
            <p className="counts" title="Relationships in the current view">
              Incoming {incoming.length}{hidden?.up ? ` (+${hidden.up} hidden)` : ''} · Outgoing {outgoing.length}{hidden?.down ? ` (+${hidden.down} hidden)` : ''}
            </p>

            {related.length > 0 && (
              <>
                <h3>Related Nodes</h3>
                <ul className="dp-nodelist">{related.map((x) => <NodeRow key={x.id} n={x} onSelect={p.onSelect} />)}</ul>
              </>
            )}
            {callers.length > 0 && (
              <>
                <h3>Incoming Calls ({callers.length})</h3>
                <ul className="dp-nodelist">{callers.map((x) => <NodeRow key={x.id} n={x} onSelect={p.onSelect} />)}</ul>
              </>
            )}

            {(incoming.length > 0 || outgoing.length > 0) && (
              <details className="dp-evidence">
                <summary>Relationships &amp; evidence</summary>
                {incoming.length > 0 && (
                  <>
                    <h4>Incoming</h4>
                    <ul className="edge-list">{incoming.map((e) => <EdgeRow key={e.id} e={e} other={byId.get(e.source)} dir="in" onOpenEvidence={p.onOpenEvidence} onSelect={p.onSelect} />)}</ul>
                  </>
                )}
                {outgoing.length > 0 && (
                  <>
                    <h4>Outgoing</h4>
                    <ul className="edge-list">{outgoing.map((e) => <EdgeRow key={e.id} e={e} other={byId.get(e.target)} dir="out" onOpenEvidence={p.onOpenEvidence} onSelect={p.onSelect} />)}</ul>
                  </>
                )}
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}

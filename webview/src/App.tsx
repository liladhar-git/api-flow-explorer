import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { HostToWebviewSchema } from '../../src/messaging/messageSchemas';
import type { FilterState } from '../../src/types/filterState';
import { ApiTesterPanel } from './components/ApiTesterPanel';
import { BottomDock } from './components/BottomDock';
import { EndpointDetails } from './components/EndpointDetails';
import { GraphCanvas } from './components/GraphCanvas';
import { NodeActionsContext } from './components/GraphNode';
import { GraphToolbar } from './components/GraphToolbar';
import { LayerPipeline } from './components/LayerPipeline';
import { METHOD_ORDER } from './shared/FiltersForm';
import { applyFilters } from './state/filters';
import { initialState, reducer } from './state/store';
import { buildTrace } from './state/trace';
import { post } from './vscodeApi';

const n = (x: number) => x.toLocaleString('en-US');

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [fitSignal, setFitSignal] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const parsed = HostToWebviewSchema.safeParse(event.data);
      if (parsed.success) dispatch({ type: 'host', msg: parsed.data });
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const view = useMemo(() => applyFilters(state.nodes, state.edges, state.filters, state.focusId), [state.nodes, state.edges, state.filters, state.focusId]);
  const methods = useMemo(() => METHOD_ORDER.filter((m) => state.endpoints.some((e) => e.method === m)), [state.endpoints]);
  const frameworks = useMemo(() => [...new Set(state.endpoints.map((e) => e.framework))].sort(), [state.endpoints]);
  const traceStart = state.selection?.type === 'node' ? state.selection.id : state.focusId;
  const trace = useMemo(() => buildTrace(view.nodes, view.edges, traceStart), [view.nodes, view.edges, traceStart]);

  const focus = useCallback((nodeId: string) => post({ type: 'focus', nodeId, depth: state.depth }), [state.depth]);
  const actions = useMemo(() => ({ expand: (nodeId: string, direction: 'upstream' | 'downstream') => post({ type: 'expand', nodeId, direction, depth: 1 }) }), []);
  /** Filters are shared with the sidebar: apply locally for an instant response and tell the host to relay them. */
  const changeFilters = useCallback((filterState: FilterState) => {
    dispatch({ type: 'setFilterState', filterState });
    post({ type: 'setFilters', filters: filterState });
  }, []);

  const showGraph = view.nodes.length > 0;
  const tester = state.activeTab === 'tester';
  return (
    <>
      <div className={`app${tester ? ' app-hidden' : ''}${state.panelOpen ? '' : ' panel-closed'}${state.panelWide ? ' panel-wide' : ''}`} aria-hidden={tester}>
        <main className="main">
          <GraphToolbar
            scanning={state.scanning}
            hasGraph={showGraph}
            direction={state.layoutDir}
            depth={state.depth}
            openOnClick={state.openOnClick}
            onScan={() => post({ type: 'requestScan' })}
            onFit={() => setFitSignal((x) => x + 1)}
            onResetLayout={() => setResetSignal((x) => x + 1)}
            onDirection={(dir) => dispatch({ type: 'layoutDir', dir })}
            onDepth={(depth) => {
              dispatch({ type: 'depth', depth });
              if (state.focusId) post({ type: 'focus', nodeId: state.focusId, depth });
            }}
            onOpenOnClick={(value) => dispatch({ type: 'openOnClick', value })}
            onExportMermaid={() => post({ type: 'exportMermaid', nodeIds: view.nodes.map((x) => x.id) })}
            onExport={(action) => post({ type: 'exportAction', action })}
          />
          {state.error && (
            <div className="banner error" role="alert">
              {state.error} <button className="af-link" onClick={() => dispatch({ type: 'dismissError' })}>Dismiss</button>
            </div>
          )}
          {state.truncated && <div className="banner warn">This view was truncated to keep it readable. Use the expand buttons on nodes to load more.</div>}
          {state.stats && (
            <div className="stats" aria-label="Analysis summary">
              <span>{n(state.stats.files)} files</span>
              <span>{n(state.stats.nodes)} nodes</span>
              <span>{n(state.stats.edges)} edges</span>
              <span>{n(state.stats.endpoints)} endpoints</span>
              <span>{n(state.stats.unresolved)} unresolved</span>
              <span>{n(state.stats.diagnostics)} diagnostics</span>
            </div>
          )}
          {showGraph && <LayerPipeline />}

          {state.scanning && <div className="empty" role="status">Scanning workspace… {state.progress}</div>}
          {!state.scanning && !state.hasAnalysis && (
            <div className="empty">
              <h2>No analysis yet</h2>
              <p>Scan the workspace to discover endpoints, handlers and data access. Nothing leaves your machine and no code is executed.</p>
              <button className="tb-primary" onClick={() => post({ type: 'requestScan' })}>Scan Workspace</button>
            </div>
          )}
          {!state.scanning && state.hasAnalysis && state.endpoints.length === 0 && (
            <div className="empty">
              <h2>No API endpoints found</h2>
              <p>Supported: Express routes, NestJS controllers, Next.js route handlers and API routes. Check the “API Flow Explorer” output channel for diagnostics about unsupported or unresolved code.</p>
            </div>
          )}
          {!state.scanning && state.hasAnalysis && state.endpoints.length > 0 && !showGraph && (
            <div className="empty">
              <h2>Pick an endpoint</h2>
              <p>Choose an endpoint in the API Flow Explorer sidebar (left) to see the requests that reach it and the handlers, services and data stores behind it.</p>
            </div>
          )}
          {showGraph && (
            <NodeActionsContext.Provider value={actions}>
              <GraphCanvas
                nodes={view.nodes}
                edges={view.edges}
                hidden={state.hidden}
                focusId={state.focusId}
                direction={state.layoutDir}
                graphVersion={state.graphVersion}
                selection={state.selection}
                locked={state.locked}
                fitSignal={fitSignal}
                resetLayoutSignal={resetSignal}
                onToggleLock={() => dispatch({ type: 'locked', value: !state.locked })}
                onSelect={(selection) => dispatch({ type: 'select', selection })}
                onNodeClick={(id) => state.openOnClick && post({ type: 'openNode', nodeId: id })}
              />
            </NodeActionsContext.Provider>
          )}
          {!state.panelOpen && showGraph && (
            <button className="panel-reopen" onClick={() => dispatch({ type: 'panel', open: true })} title="Show the details panel">
              ◂ Details
            </button>
          )}
          <BottomDock
            open={state.dock.open}
            tab={state.dock.tab}
            filters={state.filterState}
            methods={methods}
            frameworks={frameworks}
            trace={trace}
            onChangeFilters={changeFilters}
            onDock={(change) => dispatch({ type: 'dock', ...change })}
            onOpenEvidence={(edgeId) => post({ type: 'openEvidence', edgeId })}
          />
        </main>

        {state.panelOpen && (
          <aside className="details-col">
            <EndpointDetails
              selection={state.selection}
              nodes={view.nodes}
              edges={view.edges}
              hidden={state.hidden}
              tab={state.panelTab}
              wide={state.panelWide}
              trace={trace}
              onTab={(tab) => dispatch({ type: 'panel', tab })}
              onClose={() => dispatch({ type: 'panel', open: false })}
              onToggleWide={() => dispatch({ type: 'panel', wide: !state.panelWide })}
              onOpenNode={(nodeId) => post({ type: 'openNode', nodeId })}
              onOpenEvidence={(edgeId) => post({ type: 'openEvidence', edgeId })}
              onExpand={(nodeId, direction) => post({ type: 'expand', nodeId, direction, depth: 1 })}
              onFocus={focus}
              onSelect={(selection) => dispatch({ type: 'select', selection })}
              onTestEndpoint={(endpoint) => dispatch({ type: 'prepopulateFromEndpoint', endpoint })}
            />
          </aside>
        )}
      </div>

      {tester && (
        <div className="tester-page" role="region" aria-label="API Tester page">
          <div className="tester-page-bar">
            <button onClick={() => dispatch({ type: 'setTab', tab: 'details' })} title="Return to the graph">
              ← Back to graph
            </button>
            <strong>⚡ API Tester</strong>
            <span className="hint tester-page-target">
              {state.activeRequest.method} {state.activeRequest.url}
            </span>
          </div>
          <div className="tester-page-body">
            <ApiTesterPanel
              fullPage
              request={state.activeRequest}
              response={state.activeResponse}
              isExecuting={state.isRequestExecuting}
              environmentVariables={state.environmentVariables}
              onUpdateRequest={(req) => dispatch({ type: 'updateRequest', request: req })}
              onSetEnvironmentVariable={(key, value) => {
                dispatch({ type: 'setEnvironmentVariable', key, value });
                if (key === 'baseUrl') post({ type: 'setBaseUrl', value });
              }}
              onExecute={() => post({ type: 'executeRequest', request: state.activeRequest, environmentVariables: state.environmentVariables })}
              onCancel={() => post({ type: 'cancelRequest', requestId: state.activeRequest.id })}
            />
          </div>
        </div>
      )}
    </>
  );
}

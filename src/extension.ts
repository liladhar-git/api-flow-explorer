import * as vscode from 'vscode';
import type { AppState } from './appState';
import { analyzeImpact } from './commands/analyzeImpact';
import { exportGraphJson, exportMarkdownDocs, exportMermaidFlow } from './commands/exportCommands';
import { findApiFlows } from './commands/findApiFlows';
import { findReferences } from './commands/findReferences';
import { runScan, summarize } from './commands/scanWorkspace';
import type { Services } from './commands/services';
import { showApiGraph } from './commands/showApiGraph';
import { listEndpoints } from './graph/graphQueries';
import { BASE_URL_KEY, createMessageHandler } from './messaging/messageHandlers';
import { WebviewToHostSchema } from './messaging/messageSchemas';
import { EndpointsViewProvider } from './providers/endpointsView';
import { FilterRelay } from './providers/filterRelay';
import { sidebarGroups } from './graph/sidebarData';
import { isFiltered } from './types/filterState';
import { GraphPanel } from './providers/graphViewProvider';
import { Debouncer, isRelevantChange } from './scanner/rescanScheduler';

export function activate(context: vscode.ExtensionContext) {
  const state: AppState = { scanning: false };
  const output = vscode.window.createOutputChannel('API Flow Explorer');
  const filters = new FilterRelay();
  const sidebar = new EndpointsViewProvider(context.extensionUri, filters);

  const services: Services = {
    context,
    state,
    sidebar,
    filters,
    output,
    refreshPanel() {
      sidebar.setState({ hasAnalysis: !!state.graph, scanning: state.scanning, endpoints: state.graph ? listEndpoints(state.graph) : undefined, groups: state.graph ? sidebarGroups(state.graph) : undefined });
      const panel = GraphPanel.active;
      if (!panel) return;
      const stats = state.graph && state.report ? summarize(state.report, state.graph.nodes.length, state.graph.edges.length, listEndpoints(state.graph).length) : undefined;
      panel.post({ type: 'state', hasAnalysis: !!state.graph, scanning: state.scanning, stats });
      panel.post({ type: 'filters', filters: filters.get() });
      const savedBase = context.workspaceState.get<string>(BASE_URL_KEY);
      if (savedBase !== undefined) panel.post({ type: 'baseUrl', value: savedBase });
      if (state.graph) panel.post({ type: 'endpoints', endpoints: listEndpoints(state.graph) });
    },
    showGraph(nodeId) {
      showApiGraph(context, services, handler, nodeId);
    },
  };
  const handler = createMessageHandler(services);

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider(EndpointsViewProvider.viewType, sidebar, { webviewOptions: { retainContextWhenHidden: true } }),
  );
  // one filter state for both webviews: a change from one side is forwarded to the other, never echoed back
  filters.onChange((f, origin) => {
    if (origin !== 'sidebar') sidebar.pushFilters(f);
    if (origin !== 'graph') GraphPanel.active?.post({ type: 'filters', filters: f });
    void vscode.commands.executeCommand('setContext', 'apiFlowExplorer.endpointFilterActive', isFiltered(f));
  });

  const register = (name: string, fn: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(`apiFlowExplorer.${name}`, fn));

  register('scanWorkspace', () => runScan(services, false));
  register('fullRescan', () => runScan(services, true));
  register('showApiGraph', (nodeId?: unknown) => services.showGraph(typeof nodeId === 'string' ? nodeId : undefined));
  register('searchEndpoints', async () => {
    await vscode.commands.executeCommand('apiFlowExplorer.flows.focus'); // reveal the sidebar view, then put the caret in its search box
    sidebar.focusSearch();
  });
  register('clearEndpointSearch', () => filters.reset());
  register('findApiFlows', () => findApiFlows(services));
  register('findReferences', () => findReferences(services));
  register('analyzeImpact', (nodeId?: unknown) => analyzeImpact(services, typeof nodeId === 'string' ? nodeId : undefined));
  register('exportGraphJson', () => exportGraphJson(services));
  register('exportMermaid', (nodeIds?: unknown) => exportMermaidFlow(services, Array.isArray(nodeIds) ? (nodeIds as string[]) : undefined));
  register('exportMarkdown', () => exportMarkdownDocs(services));

  // --- incremental re-analysis on file changes (debounced) ---------------------------------------
  const debouncer = new Debouncer(1200, () => {
    if (state.graph && !state.scanning) void runScan(services, false, true);
  });
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,json,yaml}');
  const onFsEvent = (uri: vscode.Uri) => {
    const cfg = vscode.workspace.getConfiguration('apiFlowExplorer');
    if (!cfg.get<boolean>('autoRescan', true) || !state.graph || !state.root) return;
    const rel = uri.fsPath.startsWith(state.root) ? uri.fsPath.slice(state.root.length + 1).split('\\').join('/') : undefined;
    if (rel && isRelevantChange(rel, { includeTests: cfg.get<boolean>('includeTests', false), ignoredDirectories: cfg.get<string[]>('ignoredDirectories', []) })) debouncer.trigger();
  };
  context.subscriptions.push(watcher, watcher.onDidChange(onFsEvent), watcher.onDidCreate(onFsEvent), watcher.onDidDelete(onFsEvent), { dispose: () => debouncer.dispose() });

  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void vscode.window.showInformationMessage('API Flow Explorer: workspace trusted. Run "Scan Workspace" to analyze it.');
    }),
  );

  /** Same validation + handling path as a real webview message; used by integration tests. */
  const dispatchWebviewMessage = async (raw: unknown): Promise<boolean> => {
    const parsed = WebviewToHostSchema.safeParse(raw);
    const panel = GraphPanel.active;
    if (!parsed.success || !panel) return false;
    await handler(parsed.data, panel);
    return true;
  };
  return { state, services, dispatchWebviewMessage, webviewStatus: () => ({ open: !!GraphPanel.active, ready: !!GraphPanel.active?.isReady }) };
}

export function deactivate() {}

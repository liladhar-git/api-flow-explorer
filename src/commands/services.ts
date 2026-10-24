import type * as vscode from 'vscode';
import type { AppState } from '../appState';
import type { EndpointsViewProvider } from '../providers/endpointsView';
import type { FilterRelay } from '../providers/filterRelay';

export interface Services {
  context: vscode.ExtensionContext;
  state: AppState;
  sidebar: EndpointsViewProvider;
  /** Filters shared by the sidebar and the graph page. */
  filters: FilterRelay;
  output: vscode.OutputChannel;
  /** Pushes current state/endpoints to an open graph panel, if any. */
  refreshPanel(): void;
  /** Opens (or reveals) the graph panel, optionally focused on a node. */
  showGraph(nodeId?: string): void;
}

import type * as vscode from 'vscode';
import type { WebviewToHost } from '../messaging/messageSchemas';
import { GraphPanel } from '../providers/graphViewProvider';
import type { Services } from './services';

/** Opens the graph panel; when a node id is given, focuses the endpoint-centric view on it. */
export function showApiGraph(context: vscode.ExtensionContext, s: Services, handler: (m: WebviewToHost, p: GraphPanel) => Promise<void>, nodeId?: string): void {
  const panel = GraphPanel.show(context, handler);
  s.refreshPanel();
  if (nodeId) void handler({ type: 'focus', nodeId, depth: 3 }, panel);
}

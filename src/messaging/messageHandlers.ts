import * as vscode from 'vscode';
import type { WebviewToHost } from './messageSchemas';
import type { GraphPanel } from '../providers/graphViewProvider';
import type { Services } from '../commands/services';
import { openLocation } from '../commands/openSource';
import { expandView, focusView, listEndpoints, type Subgraph } from '../graph/graphQueries';
import { locationOfEdge, locationOfNode } from '../graph/sourceLocation';
import { executeApiRequest } from '../apiTest/requestRunner';

export const BASE_URL_KEY = 'apiFlowExplorer.testerBaseUrl';

/** Handles validated webview messages. The webview only ever names graph IDs; paths are looked up here. */
export function createMessageHandler(s: Services) {
  let visible = new Set<string>();
  const activeRequests = new Map<string, AbortController>();

  const show = (panel: GraphPanel, sub: Subgraph, focusId?: string) => {
    visible = new Set(sub.nodes.map((n) => n.id));
    panel.post({ type: 'subgraph', nodes: sub.nodes, edges: sub.edges, hidden: sub.hidden, truncated: sub.truncated, focusId });
  };

  return async (message: WebviewToHost, panel: GraphPanel): Promise<void> => {
    const { state } = s;
    switch (message.type) {
      case 'ready':
        s.refreshPanel();
        return;
      case 'requestScan':
        await vscode.commands.executeCommand('apiFlowExplorer.scanWorkspace');
        return;
      case 'listEndpoints':
        if (state.graph) panel.post({ type: 'endpoints', endpoints: listEndpoints(state.graph) });
        return;
      case 'focus': {
        if (!state.index) return panel.post({ type: 'error', message: 'No analysis available. Scan the workspace first.' });
        const sub = focusView(state.index, message.nodeId, message.depth);
        if (!sub) return panel.post({ type: 'error', message: 'That node no longer exists. The workspace may have changed; rescan.' });
        show(panel, sub, message.nodeId);
        return;
      }
      case 'expand': {
        if (!state.index) return;
        show(panel, expandView(state.index, visible, message.nodeId, message.direction, message.depth), message.nodeId);
        return;
      }
      case 'openNode':
      case 'openEvidence': {
        if (!state.index || !state.root) return;
        const loc = message.type === 'openNode' ? locationOfNode(state.index, state.root, message.nodeId) : locationOfEdge(state.index, state.root, message.edgeId);
        if (!loc) return panel.post({ type: 'error', message: 'This item has no source location (it is external or synthetic).' });
        try {
          await openLocation(loc);
        } catch (e) {
          panel.post({ type: 'error', message: `Could not open ${loc.file.split('/').pop()}: ${(e as Error).message}` });
        }
        return;
      }
      case 'setBaseUrl':
        await s.context.workspaceState.update(BASE_URL_KEY, message.value);
        return;
      case 'setFilters':
        s.filters.update(message.filters, 'graph');
        return;
      case 'exportAction':
        await vscode.commands.executeCommand(message.action === 'markdown' ? 'apiFlowExplorer.exportMarkdown' : 'apiFlowExplorer.exportGraphJson');
        return;
      case 'exportMermaid':
        await vscode.commands.executeCommand('apiFlowExplorer.exportMermaid', message.nodeIds);
        return;
      case 'executeRequest': {
        const controller = new AbortController();
        activeRequests.set(message.request.id, controller);
        panel.post({ type: 'requestStarted', requestId: message.request.id });
        try {
          const response = await executeApiRequest(message.request, message.environmentVariables, controller.signal);
          if (!controller.signal.aborted) {
            panel.post({ type: 'requestFinished', response });
          } else {
            panel.post({ type: 'requestCancelled', requestId: message.request.id });
          }
        } catch (e) {
          panel.post({
            type: 'requestFinished',
            response: {
              requestId: message.request.id,
              status: 0,
              statusText: 'Client Error',
              durationMs: 0,
              sizeBytes: 0,
              headers: {},
              body: '',
              isJson: false,
              truncated: false,
              error: (e as Error).message,
              timing: { start: Date.now(), end: Date.now() },
            },
          });
        } finally {
          activeRequests.delete(message.request.id);
        }
        return;
      }
      case 'cancelRequest': {
        const controller = activeRequests.get(message.requestId);
        if (controller) {
          controller.abort(new Error('Cancelled by user'));
          activeRequests.delete(message.requestId);
        }
        panel.post({ type: 'requestCancelled', requestId: message.requestId });
        return;
      }
    }
  };
}

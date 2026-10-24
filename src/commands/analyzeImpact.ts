import * as vscode from 'vscode';
import { analyzeImpact as computeImpact, formatImpact } from '../graph/impactAnalyzer';
import { locationOfNode } from '../graph/sourceLocation';
import { ensureAnalysis, symbolAtCursor } from './analysisGuard';
import { openLocation } from './openSource';
import type { Services } from './services';

/** Reverse-dependency analysis for the symbol at the cursor (or a node id passed by another command). */
export async function analyzeImpact(s: Services, nodeId?: string): Promise<void> {
  if (!(await ensureAnalysis(s)) || !s.state.index || !s.state.root) return;
  const id = nodeId ?? symbolAtCursor(s)?.id;
  const report = id ? computeImpact(s.state.index, id) : undefined;
  if (!report) {
    void vscode.window.showInformationMessage('API Flow Explorer: place the cursor inside a function, class or handler that appears in the analysis.');
    return;
  }
  s.output.appendLine('');
  s.output.appendLine(formatImpact(report));
  const items = [...report.endpoints, ...report.requests, ...report.frontend, ...report.dependents].slice(0, 200);
  const pick = await vscode.window.showQuickPick(
    [
      { label: '$(type-hierarchy) Show impact in graph', id: '__graph__', description: `${report.endpoints.length} endpoint(s), ${report.requests.length} request(s), ${report.frontend.length} page/component(s)` },
      ...items.map((it) => ({
        label: `${it.node.kind === 'api-endpoint' ? '$(globe)' : '$(symbol-event)'} ${it.node.name}`,
        description: `${it.node.kind} · ${it.distance} hop(s) · ${it.path.confidence}${it.path.certain ? '' : ' (inferred path)'}`,
        detail: it.node.path ? `${it.node.path}:${it.node.startLine ?? 1}` : undefined,
        id: it.node.id,
      })),
    ],
    { placeHolder: `Impact of changing ${report.target.qualifiedName ?? report.target.name}: ${items.length} dependent(s)`, matchOnDetail: true },
  );
  if (!pick) return;
  if (pick.id === '__graph__') {
    s.showGraph(report.target.id);
    return;
  }
  const loc = locationOfNode(s.state.index, s.state.root, pick.id);
  if (loc) await openLocation(loc, false);
}

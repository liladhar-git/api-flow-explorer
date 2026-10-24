import * as vscode from 'vscode';
import { listEndpoints } from '../graph/graphQueries';
import { ensureAnalysis } from './analysisGuard';
import type { Services } from './services';

export async function findApiFlows(s: Services): Promise<void> {
  if (!(await ensureAnalysis(s)) || !s.state.graph) return;
  const endpoints = listEndpoints(s.state.graph);
  if (!endpoints.length) {
    void vscode.window.showInformationMessage('API Flow Explorer: no endpoints were found. See the output channel for diagnostics.');
    return;
  }
  const pick = await vscode.window.showQuickPick(
    endpoints.map((e) => ({ label: `${e.method} ${e.path}`, description: e.framework, detail: `${e.file}:${e.line}`, id: e.id })),
    { placeHolder: 'Search API flows by method, path or file', matchOnDetail: true, matchOnDescription: true },
  );
  if (pick) s.showGraph(pick.id);
}

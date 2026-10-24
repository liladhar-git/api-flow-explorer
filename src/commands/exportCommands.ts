import * as path from 'node:path';
import * as vscode from 'vscode';
import { exportJson } from '../export/exportJson';
import { exportMarkdown } from '../export/exportMarkdown';
import { exportMermaid, wrapMermaidMarkdown } from '../export/exportMermaid';
import { focusView, listEndpoints } from '../graph/graphQueries';
import { ensureAnalysis } from './analysisGuard';
import type { Services } from './services';

async function saveText(s: Services, defaultName: string, filters: Record<string, string[]>, text: string): Promise<void> {
  const base = s.state.root ? vscode.Uri.file(path.join(s.state.root, defaultName)) : undefined;
  const target = await vscode.window.showSaveDialog({ defaultUri: base, filters, saveLabel: 'Export' });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
  void vscode.window.showInformationMessage(`API Flow Explorer: exported to ${target.fsPath}`);
}

export async function exportGraphJson(s: Services): Promise<void> {
  if (!(await ensureAnalysis(s)) || !s.state.graph) return;
  await saveText(s, 'api-flow-graph.json', { JSON: ['json'] }, exportJson(s.state.graph));
}

export async function exportMarkdownDocs(s: Services): Promise<void> {
  if (!(await ensureAnalysis(s)) || !s.state.graph) return;
  await saveText(s, 'api-flow-docs.md', { Markdown: ['md'] }, exportMarkdown(s.state.graph));
}

/** Mermaid for the flow currently shown in the graph (nodeIds from the webview) or a flow picked from a list. */
export async function exportMermaidFlow(s: Services, nodeIds?: string[]): Promise<void> {
  if (!(await ensureAnalysis(s)) || !s.state.graph || !s.state.index) return;
  let ids = Array.isArray(nodeIds) && nodeIds.every((n) => typeof n === 'string') ? nodeIds : undefined;
  let title = 'API flow';
  if (!ids?.length) {
    const eps = listEndpoints(s.state.graph);
    const pick = await vscode.window.showQuickPick(eps.map((e) => ({ label: `${e.method} ${e.path}`, detail: `${e.file}:${e.line}`, id: e.id })), { placeHolder: 'Endpoint flow to export as Mermaid' });
    if (!pick) return;
    ids = focusView(s.state.index, pick.id, 4)?.nodes.map((n) => n.id) ?? [];
    title = pick.label;
  }
  const diagram = exportMermaid(s.state.graph, ids);
  await vscode.env.clipboard.writeText(diagram);
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: wrapMermaidMarkdown(diagram, title) });
  await vscode.window.showTextDocument(doc, { preview: false });
  void vscode.window.showInformationMessage('API Flow Explorer: Mermaid diagram opened and copied to the clipboard.');
}

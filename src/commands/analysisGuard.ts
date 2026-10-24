import * as path from 'node:path';
import * as vscode from 'vscode';
import { nodeAtPosition } from '../graph/graphQueries';
import type { GraphNode } from '../types/graph';
import { runScan } from './scanWorkspace';
import type { Services } from './services';

/** Makes sure an analysis exists, offering to scan when it does not. */
export async function ensureAnalysis(s: Services): Promise<boolean> {
  if (s.state.index) return true;
  const choice = await vscode.window.showInformationMessage('API Flow Explorer: the workspace has not been analyzed yet.', 'Scan Workspace');
  if (choice !== 'Scan Workspace') return false;
  await runScan(s, false);
  return !!s.state.index;
}

/** Graph node for the code symbol under the active editor's cursor. */
export function symbolAtCursor(s: Services): GraphNode | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !s.state.index || !s.state.root) return undefined;
  const rel = path.relative(s.state.root, editor.document.uri.fsPath).split(path.sep).join('/');
  if (rel.startsWith('..')) return undefined;
  return nodeAtPosition(s.state.index, rel, editor.selection.active.line + 1);
}

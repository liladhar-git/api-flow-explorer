import * as vscode from 'vscode';
import { referencesTo } from '../graph/graphQueries';
import { locationOfEdge } from '../graph/sourceLocation';
import { ensureAnalysis, symbolAtCursor } from './analysisGuard';
import { openLocation } from './openSource';
import type { Services } from './services';

/** Graph references: everything the analysis found calling, rendering, routing to or requesting the symbol at the cursor. */
export async function findReferences(s: Services): Promise<void> {
  if (!(await ensureAnalysis(s)) || !s.state.index || !s.state.root) return;
  const node = symbolAtCursor(s);
  if (!node) {
    void vscode.window.showInformationMessage('API Flow Explorer: place the cursor inside a function, class or route handler that appears in the analysis.');
    return;
  }
  const refs = referencesTo(s.state.index, node.id);
  if (!refs.length) {
    void vscode.window.showInformationMessage(`API Flow Explorer: no statically resolved references to ${node.name} were found.`);
    return;
  }
  const pick = await vscode.window.showQuickPick(
    refs.map(({ edge, from }) => ({
      label: `$(symbol-method) ${from.name}`,
      description: `${edge.kind} · ${edge.confidence}${edge.resolution === 'resolved' ? '' : ` ${edge.resolution}`}`,
      detail: `${edge.evidence.path}:${edge.evidence.line} — ${edge.evidence.explanation}`,
      edgeId: edge.id,
    })),
    { placeHolder: `${refs.length} reference(s) to ${node.qualifiedName ?? node.name}`, matchOnDetail: true },
  );
  if (!pick) return;
  const loc = locationOfEdge(s.state.index, s.state.root, pick.edgeId);
  if (loc) await openLocation(loc, false);
}

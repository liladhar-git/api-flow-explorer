import * as vscode from 'vscode';
import type { SourceLocation } from '../graph/sourceLocation';

/** Opens a file at an exact position without stealing focus from the graph panel. */
export async function openLocation(loc: SourceLocation, preserveFocus = true): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(loc.file));
  const line = Math.max(0, Math.min(loc.line - 1, doc.lineCount - 1));
  const pos = new vscode.Position(line, Math.max(0, loc.column - 1));
  const editor = await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos), viewColumn: vscode.ViewColumn.One, preserveFocus, preview: true });
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  return editor;
}

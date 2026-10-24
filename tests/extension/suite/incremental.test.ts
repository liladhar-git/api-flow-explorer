import * as assert from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { TestCase } from './index';

interface Api {
  state: { graph?: { nodes: { id: string }[] }; report?: { filesAnalyzed: number; filesFromCache: number; filesDiscovered: number }; scanning: boolean };
}

async function api(): Promise<Api> {
  const a = (await vscode.extensions.getExtension('local.api-flow-explorer')!.activate()) as Api;
  if (!a.state.graph) await vscode.commands.executeCommand('apiFlowExplorer.scanWorkspace');
  return a;
}

async function until(pred: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export const tests: TestCase[] = [
  {
    name: 'a file change triggers a debounced incremental re-analysis that reuses the cache',
    async fn() {
      const a = await api();
      assert.ok(a.state.graph!.nodes.some((n) => n.id === 'sym:server/services/userService.ts#findAll'));
      const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
      const file = path.join(root, 'server/services/userService.ts');
      const original = readFileSync(file, 'utf8');
      try {
        writeFileSync(file, original.replace('export async function findAll()', 'export async function findEveryone()'));
        await until(() => !!a.state.graph!.nodes.find((n) => n.id === 'sym:server/services/userService.ts#findEveryone'), 25_000, 'incremental update after file change');
        assert.ok(!a.state.graph!.nodes.some((n) => n.id === 'sym:server/services/userService.ts#findAll'), 'stale node still present');
        assert.ok(a.state.report!.filesFromCache > 0, 'unchanged files should come from the cache');
        assert.ok(a.state.report!.filesAnalyzed < a.state.report!.filesDiscovered, 'only affected files should be reanalyzed');
      } finally {
        writeFileSync(file, original);
      }
      await until(() => !!a.state.graph!.nodes.find((n) => n.id === 'sym:server/services/userService.ts#findAll'), 25_000, 'revert to be picked up');
    },
  },
  {
    name: 'exportMermaid with node ids opens a Mermaid document',
    async fn() {
      await api();
      await vscode.commands.executeCommand('apiFlowExplorer.exportMermaid', ['sym:server/controllers/userController.ts#listUsers', 'sym:server/services/userService.ts#findAll']);
      const doc = vscode.window.activeTextEditor?.document;
      assert.ok(doc, 'no document opened');
      assert.strictEqual(doc.languageId, 'markdown');
      const text = doc.getText();
      assert.ok(text.includes('```mermaid') && text.includes('flowchart LR') && text.includes('server/services/userService.ts:3'), text);
      assert.ok((await vscode.env.clipboard.readText()).startsWith('flowchart LR'));
      // the export opened an untitled (dirty) document: discard it so later tests never hit a "save changes?" prompt
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      assert.ok(!vscode.workspace.textDocuments.some((d) => d.isUntitled && d.getText().includes('flowchart')), 'untitled export document still open');
    },
  },
];

import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { TestCase } from './index';

interface Api {
  state: { graph?: { nodes: { id: string; kind: string; path?: string; startLine?: number }[] } };
  services: { sidebar: { all: { id: string; method: string; path: string }[]; visible(): { method: string; path: string }[]; filters: { query: string; methods: string[]; category: string }; isReady: boolean }; filters: { get(): { query: string; methods: string[] }; update(f: unknown, origin: string): void } };
  dispatchWebviewMessage(raw: unknown): Promise<boolean>;
}

async function ready(): Promise<Api> {
  const ext = vscode.extensions.getExtension('local.api-flow-explorer')!;
  const api = (await ext.activate()) as Api;
  if (!api.state.graph) await vscode.commands.executeCommand('apiFlowExplorer.scanWorkspace');
  await vscode.commands.executeCommand('apiFlowExplorer.showApiGraph');
  return api;
}

export const tests: TestCase[] = [
  {
    name: 'sidebar endpoint list is populated from the analysis and its page boots in real VS Code',
    async fn() {
      const api = await ready();
      await vscode.commands.executeCommand('apiFlowExplorer.flows.focus'); // reveal the sidebar view
      const end = Date.now() + 20_000;
      while (!api.services.sidebar.isReady && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
      assert.ok(api.services.sidebar.isReady, 'sidebar webview never completed the ready handshake (script blocked by CSP or bad resource URI?)');
      const labels = api.services.sidebar.all.map((e) => `${e.method} ${e.path}`);
      assert.ok(labels.includes('GET /api/users'), labels.join());
      assert.ok(labels.includes('PUT /api/users/:id/avatar'));
      assert.strictEqual(api.services.sidebar.visible().length, labels.length); // no filter yet
    },
  },
  {
    name: 'search commands focus the sidebar search box and clear the filter without errors',
    async fn() {
      const api = await ready();
      await vscode.commands.executeCommand('apiFlowExplorer.searchEndpoints');
      await vscode.commands.executeCommand('apiFlowExplorer.clearEndpointSearch');
      assert.strictEqual(api.services.sidebar.filters.query, '');
      assert.deepStrictEqual(api.services.sidebar.filters.methods, []);

      // filters set from the graph page reach the shared state and the sidebar
      assert.ok(await api.dispatchWebviewMessage({ type: 'setFilters', filters: { query: 'user', category: 'all', methods: ['GET'], frameworks: [], hiddenKinds: [], hiddenConfidence: [] } }));
      assert.strictEqual(api.services.filters.get().query, 'user');
      assert.strictEqual(api.services.sidebar.filters.query, 'user');
      assert.ok(api.services.sidebar.visible().every((e) => e.method === 'GET' && /user/i.test(e.path)));
      await vscode.commands.executeCommand('apiFlowExplorer.clearEndpointSearch');
      assert.strictEqual(api.services.sidebar.filters.query, '');
      assert.strictEqual(api.services.sidebar.visible().length, api.services.sidebar.all.length);
    },
  },
  {
    name: 'clicking a node opens its file at the exact source line',
    async fn() {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      const api = await ready();
      const id = 'sym:server/controllers/userController.ts#listUsers';
      const node = api.state.graph!.nodes.find((n) => n.id === id)!;
      assert.ok(node, 'node missing from graph');
      assert.strictEqual(await api.dispatchWebviewMessage({ type: 'openNode', nodeId: id }), true);
      const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath.endsWith(path.join('server', 'controllers', 'userController.ts')));
      assert.ok(editor, 'editor for userController.ts is not visible');
      assert.strictEqual(editor.selection.active.line, node.startLine! - 1);
      assert.ok(editor.document.lineAt(editor.selection.active.line).text.includes('listUsers'));
    },
  },
  {
    name: 'edge evidence opens the call site line',
    async fn() {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      const api = await ready();
      const ok = await api.dispatchWebviewMessage({ type: 'openEvidence', edgeId: 'calls|sym:server/controllers/userController.ts#listUsers|sym:server/services/userService.ts#findAll' });
      assert.strictEqual(ok, true);
      const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath.endsWith('userController.ts'));
      assert.ok(editor);
      assert.ok(editor.document.lineAt(editor.selection.active.line).text.includes('findAll'));
    },
  },
  {
    name: 'malformed or path-carrying webview messages are rejected',
    async fn() {
      const api = await ready();
      assert.strictEqual(await api.dispatchWebviewMessage({ type: 'openFile', path: '/etc/passwd' }), false);
      assert.strictEqual(await api.dispatchWebviewMessage({ type: 'openNode' }), false);
      // an unknown id must not open anything
      await api.dispatchWebviewMessage({ type: 'openNode', nodeId: '../../../../etc/passwd' });
      assert.ok(!vscode.window.visibleTextEditors.some((e) => e.document.uri.fsPath.includes('passwd')));
    },
  },
];

import * as assert from 'node:assert';
import * as vscode from 'vscode';
import type { TestCase } from './index';

interface Api {
  state: { lastError?: string; scanning?: boolean; graph?: { nodes: { id: string; kind: string }[]; edges: unknown[] }; report?: { filesDiscovered: number } };
}

async function api(): Promise<Api> {
  const ext = vscode.extensions.getExtension('local.api-flow-explorer');
  assert.ok(ext, 'extension not found');
  return (await ext.activate()) as Api;
}

export const tests: TestCase[] = [
  {
    name: 'scanWorkspace analyzes the fixture workspace in a worker',
    async fn() {
      const a = await api();
      await vscode.commands.executeCommand('apiFlowExplorer.scanWorkspace');
      assert.ok(a.state.graph, `graph missing after scan: ${a.state.lastError} trusted=${vscode.workspace.isTrusted} folders=${vscode.workspace.workspaceFolders?.length}`);
      assert.ok(a.state.graph.nodes.length > 10);
      assert.ok((a.state.report?.filesDiscovered ?? 0) > 10);
    },
  },
];

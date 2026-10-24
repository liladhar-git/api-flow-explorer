import * as assert from 'node:assert';
import * as vscode from 'vscode';
import type { TestCase } from './index';

const EXPECTED = [
  'scanWorkspace', 'fullRescan', 'showApiGraph', 'findApiFlows', 'findReferences',
  'analyzeImpact', 'exportGraphJson', 'exportMermaid', 'exportMarkdown',
].map((c) => `apiFlowExplorer.${c}`);

export const tests: TestCase[] = [
  {
    name: 'all contributed commands are registered after activation',
    async fn() {
      await vscode.commands.executeCommand('apiFlowExplorer.showApiGraph');
      const all = await vscode.commands.getCommands(true);
      for (const c of EXPECTED) assert.ok(all.includes(c), `missing command ${c}`);
    },
  },
];

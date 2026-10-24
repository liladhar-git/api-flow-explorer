import * as assert from 'node:assert';
import * as vscode from 'vscode';
import type { TestCase } from './index';

interface Api {
  webviewStatus(): { open: boolean; ready: boolean };
}

export const tests: TestCase[] = [
  {
    name: 'the webview bundle boots inside a real VS Code webview (CSP, resource roots) and completes the ready handshake',
    async fn() {
      const api = (await vscode.extensions.getExtension('liladhar.api-flow-explorer')!.activate()) as Api;
      await vscode.commands.executeCommand('apiFlowExplorer.showApiGraph');
      assert.ok(api.webviewStatus().open, 'panel did not open');
      const end = Date.now() + 20_000;
      while (!api.webviewStatus().ready && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
      assert.ok(api.webviewStatus().ready, 'webview never posted "ready": the script did not run (blocked by CSP or bad resource URI?)');
    },
  },
];

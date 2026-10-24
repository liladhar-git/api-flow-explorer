import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { buildHtml } from './htmlTemplate';
import { HostToWebviewSchema, WebviewToHostSchema, type HostToWebview, type WebviewToHost } from '../messaging/messageSchemas';

export type MessageSink = (message: WebviewToHost, panel: GraphPanel) => void | Promise<void>;

/** Owns the single graph webview panel. All traffic is validated with Zod in both directions. */
export class GraphPanel implements vscode.Disposable {
  private static current: GraphPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;
  private queue: HostToWebview[] = [];

  static show(context: vscode.ExtensionContext, onMessage: MessageSink): GraphPanel {
    if (GraphPanel.current) {
      GraphPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return GraphPanel.current;
    }
    const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel('apiFlowExplorer.graph', 'API Flow Graph', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      // Only the bundled webview assets may be loaded; the analyzed workspace is not reachable.
      localResourceRoots: [webviewRoot],
    });
    GraphPanel.current = new GraphPanel(panel, webviewRoot, onMessage);
    return GraphPanel.current;
  }

  static get active(): GraphPanel | undefined {
    return GraphPanel.current;
  }

  private constructor(panel: vscode.WebviewPanel, webviewRoot: vscode.Uri, onMessage: MessageSink) {
    this.panel = panel;
    panel.webview.html = renderHtml(panel.webview, webviewRoot);
    this.disposables.push(
      panel.webview.onDidReceiveMessage((raw: unknown) => {
        const parsed = WebviewToHostSchema.safeParse(raw);
        if (!parsed.success) return; // drop anything that is not a known, well-formed message
        if (parsed.data.type === 'ready') {
          this.ready = true;
          for (const m of this.queue.splice(0)) void panel.webview.postMessage(m);
        }
        void onMessage(parsed.data, this);
      }),
      panel.onDidDispose(() => this.dispose()),
    );
  }

  /** True once the webview script has loaded and sent `ready` (i.e. it ran under the real CSP and resource roots). */
  get isReady(): boolean {
    return this.ready;
  }

  post(message: HostToWebview): void {
    HostToWebviewSchema.parse(message);
    if (!this.ready) {
      this.queue.push(message);
      return;
    }
    void this.panel.webview.postMessage(message);
  }

  dispose(): void {
    GraphPanel.current = undefined;
    while (this.disposables.length) this.disposables.pop()?.dispose();
    this.panel.dispose();
  }
}

export function renderHtml(webview: vscode.Webview, webviewRoot: vscode.Uri): string {
  return buildHtml({
    nonce: randomBytes(16).toString('base64'),
    cspSource: webview.cspSource,
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'index.js')).toString(),
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'index.css')).toString(),
  });
}

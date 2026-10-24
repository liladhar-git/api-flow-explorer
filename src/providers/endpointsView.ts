import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { searchEndpoints } from '../graph/endpointSearch';
import { HostToSidebarSchema, SidebarToHostSchema, type HostToSidebar, type SidebarGroups } from '../messaging/sidebarMessages';
import type { EndpointSummary } from '../types/endpointSummary';
import type { FilterState } from '../types/filterState';
import type { FilterRelay } from './filterRelay';
import { buildSidebarHtml } from './htmlTemplate';

const NO_GROUPS: SidebarGroups = { requests: [], services: [], models: [], externals: [] };

/**
 * The sidebar: a small webview (not a native tree) so it can have a branded header, a real search box, category pills,
 * collapsible groups and the shared filters. The graph page does not repeat the endpoint list.
 */
export class EndpointsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'apiFlowExplorer.flows';
  private view?: vscode.WebviewView;
  private endpoints: EndpointSummary[] = [];
  private groups: SidebarGroups = NO_GROUPS;
  private hasAnalysis = false;
  private scanning = false;
  private ready = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly relay: FilterRelay,
  ) {}

  get all(): EndpointSummary[] {
    return this.endpoints;
  }

  get groupData(): SidebarGroups {
    return this.groups;
  }

  get filters(): FilterState {
    return this.relay.get();
  }

  /** Endpoints matching the shared filters exactly as the page shows them. */
  visible(): EndpointSummary[] {
    const f = this.relay.get();
    return searchEndpoints(this.endpoints, { query: f.query, methods: f.methods, frameworks: f.frameworks, category: f.category });
  }

  setState(s: { hasAnalysis: boolean; scanning: boolean; endpoints?: EndpointSummary[]; groups?: SidebarGroups }): void {
    if (s.endpoints) this.endpoints = s.endpoints;
    if (s.groups) this.groups = s.groups;
    this.hasAnalysis = s.hasAnalysis;
    this.scanning = s.scanning;
    this.pushState();
  }

  pushFilters(filters: FilterState): void {
    this.post({ type: 'filters', filters });
  }

  focusSearch(): void {
    this.post({ type: 'focusSearch' });
  }

  get isReady(): boolean {
    return this.ready;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    const root = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview-sidebar');
    view.webview.options = { enableScripts: true, localResourceRoots: [root] };
    view.webview.html = buildSidebarHtml({
      nonce: randomBytes(16).toString('base64'),
      cspSource: view.webview.cspSource,
      scriptUri: view.webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.js')).toString(),
      styleUri: view.webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.css')).toString(),
    });
    view.webview.onDidReceiveMessage((raw: unknown) => {
      const m = SidebarToHostSchema.safeParse(raw);
      if (!m.success) return;
      const msg = m.data;
      switch (msg.type) {
        case 'ready':
          this.ready = true;
          this.pushState();
          return;
        case 'scan':
          void vscode.commands.executeCommand('apiFlowExplorer.scanWorkspace');
          return;
        case 'setFilters':
          this.relay.update(msg.filters, 'sidebar');
          return;
        case 'openEndpoint':
          // only endpoints we know about may be opened; the page cannot name arbitrary nodes
          if (this.endpoints.some((e) => e.id === msg.id)) void vscode.commands.executeCommand('apiFlowExplorer.showApiGraph', msg.id);
          return;
        case 'openItem':
          if (this.isKnownItem(msg.id)) void vscode.commands.executeCommand('apiFlowExplorer.showApiGraph', msg.id);
          return;
      }
    });
    view.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
    });
  }

  private isKnownItem(id: string): boolean {
    const g = this.groups;
    return [g.requests, g.services, g.models, g.externals].some((list) => list.some((i) => i.id === id));
  }

  private pushState(): void {
    this.post({ type: 'state', hasAnalysis: this.hasAnalysis, scanning: this.scanning, endpoints: this.endpoints, groups: this.groups, filters: this.relay.get() });
  }

  private post(msg: HostToSidebar): void {
    HostToSidebarSchema.parse(msg);
    if (this.view && this.ready) void this.view.webview.postMessage(msg);
  }
}

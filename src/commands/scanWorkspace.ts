import * as path from 'node:path';
import * as vscode from 'vscode';
import { analyzeInWorker, CancelledError } from '../analyzer/runInWorker';
import { listEndpoints, GraphIndex } from '../graph/graphQueries';
import { sidebarGroups } from '../graph/sidebarData';
import type { AnalyzerOptions, ScanReport } from '../types/analyzer';
import type { Services } from './services';

export function readOptions(root: string, cacheDir: string | undefined, fullRescan: boolean): AnalyzerOptions {
  const cfg = vscode.workspace.getConfiguration('apiFlowExplorer');
  // Configuration values are proxy objects that cannot be structured-cloned into the worker; copy to plain data.
  const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  return {
    root,
    ignoredDirectories: plain(cfg.get<string[]>('ignoredDirectories', [])),
    includeTests: cfg.get<boolean>('includeTests', false),
    maxFiles: cfg.get<number>('maxFiles', 20000),
    baseUrls: plain(cfg.get<Record<string, string>>('baseUrls', {})),
    cacheDir,
    fullRescan,
  };
}

async function pickRoot(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    void vscode.window.showWarningMessage('API Flow Explorer: open a folder or workspace first.');
    return undefined;
  }
  if (folders.length === 1) return folders[0].uri.fsPath;
  const pick = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, description: f.uri.fsPath, fsPath: f.uri.fsPath })),
    { placeHolder: 'Workspace folder to analyze' },
  );
  return pick?.fsPath;
}

export function summarize(report: ScanReport, graphNodes: number, graphEdges: number, endpoints: number) {
  return { files: report.filesDiscovered, nodes: graphNodes, edges: graphEdges, endpoints, unresolved: report.unresolvedEdges, diagnostics: report.diagnostics.length };
}

export function writeReport(s: Services, report: ScanReport, nodes: number, edges: number): void {
  const o = s.output;
  o.appendLine(`--- Scan report (${new Date().toISOString()}) ---`);
  o.appendLine(`root: ${report.root}`);
  o.appendLine(`files: ${report.filesDiscovered} discovered, ${report.filesAnalyzed} analyzed, ${report.filesFromCache} from cache, ${report.filesRemoved} removed`);
  o.appendLine(`frameworks: ${report.frameworks.join(', ') || 'none detected'}`);
  o.appendLine(`graph: ${nodes} nodes, ${edges} edges (${report.unresolvedEdges} unresolved)`);
  o.appendLine(`nodes: ${JSON.stringify(report.nodeCounts)}`);
  o.appendLine(`edges: ${JSON.stringify(report.edgeCounts)}`);
  o.appendLine(`duration: ${report.durationMs} ms${report.timingsMs ? ` (${Object.entries(report.timingsMs).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`);
  for (const d of report.diagnostics) o.appendLine(`[${d.severity}] ${d.code}${d.path ? ` ${d.path}${d.line ? ':' + d.line : ''}` : ''}: ${d.message}`);
}

export async function runScan(s: Services, fullRescan: boolean, silent = false): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    if (!silent) void vscode.window.showWarningMessage('API Flow Explorer: scanning is disabled in untrusted workspaces. Trust this workspace to analyze it.');
    return;
  }
  if (s.state.scanning) {
    if (!silent) void vscode.window.showInformationMessage('API Flow Explorer: a scan is already running.');
    return;
  }
  const root = silent && s.state.root ? s.state.root : await pickRoot();
  if (!root) return;
  const storage = s.context.storageUri?.fsPath ?? s.context.globalStorageUri.fsPath;
  const options = readOptions(root, path.join(storage, 'cache'), fullRescan);

  s.state.scanning = true;
  s.refreshPanel();
  try {
    await vscode.window.withProgress({ location: silent ? vscode.ProgressLocation.Window : vscode.ProgressLocation.Notification, title: 'API Flow Explorer', cancellable: !silent }, async (progress, token) => {
      const result = await analyzeInWorker({
        workerPath: path.join(s.context.extensionPath, 'dist', 'analyzer-worker.js'),
        options,
        token,
        onProgress: (p) => progress.report({ message: p.message }),
      });
      s.state.graph = result.graph;
      s.state.index = new GraphIndex(result.graph);
      s.state.report = result.report;
      s.state.root = root;
      const endpoints = listEndpoints(result.graph);
      s.sidebar.setState({ hasAnalysis: true, scanning: false, endpoints, groups: sidebarGroups(result.graph) });
      writeReport(s, result.report, result.graph.nodes.length, result.graph.edges.length);
      if (!silent) void vscode.window.showInformationMessage(
        `API Flow Explorer: ${endpoints.length} endpoint(s), ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges in ${result.report.durationMs} ms (${result.report.diagnostics.length} diagnostics).`,
        'Open Graph',
        'Show Report',
      ).then((choice) => {
        if (choice === 'Open Graph') void vscode.commands.executeCommand('apiFlowExplorer.showApiGraph');
        if (choice === 'Show Report') s.output.show(true);
      });
    });
  } catch (e) {
    if (e instanceof CancelledError) void vscode.window.showInformationMessage('API Flow Explorer: scan cancelled.');
    else if (silent) {
      s.state.lastError = (e as Error).message;
      s.output.appendLine(`Background rescan failed: ${(e as Error).message}`);
    } else {
      s.state.lastError = (e as Error).message;
      s.output.appendLine(`Scan failed: ${(e as { workerStack?: string }).workerStack ?? (e as Error).stack ?? e}`);
      void vscode.window.showErrorMessage(`API Flow Explorer: scan failed — ${(e as Error).message}`, 'Show Output').then((c) => c && s.output.show(true));
    }
  } finally {
    s.state.scanning = false;
    s.refreshPanel();
  }
}

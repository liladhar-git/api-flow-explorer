import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import * as path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { buildHtml, buildSidebarHtml } from '../../src/providers/htmlTemplate';
import { analyzeFixture } from '../unit/helpers';
import { focusView, GraphIndex, listEndpoints } from '../../src/graph/graphQueries';
import { sidebarGroups } from '../../src/graph/sidebarData';
import { defaultFilterState } from '../../src/types/filterState';

const ROOT = path.resolve(__dirname, '../..');
const DIST = path.join(ROOT, 'dist/webview');
const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const SHOTS = process.env.SHOT_DIR;

let server: Server;
let origin = '';
let browser: Browser;

const NONCE = 'testnonce123';

beforeAll(async () => {
  if (!existsSync(path.join(DIST, 'index.js'))) execSync('npm run build:webview', { cwd: ROOT, stdio: 'ignore' });
  server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      res.setHeader('content-type', 'text/html');
      // same template as the extension; 'self' stands in for the vscode-webview resource origin
      res.end(buildHtml({ cspSource: "'self'", scriptUri: '/index.js', styleUri: '/index.css', nonce: NONCE }));
      return;
    }
    if (url === '/sidebar') {
      res.setHeader('content-type', 'text/html');
      res.end(buildSidebarHtml({ cspSource: "'self'", scriptUri: '/sidebar/index.js', styleUri: '/sidebar/index.css', nonce: NONCE }));
      return;
    }
    if (url.startsWith('/sidebar/')) {
      const f = path.join(ROOT, 'dist/webview-sidebar', path.basename(url));
      if (!existsSync(f)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(readFileSync(f));
      return;
    }
    if (url === '/favicon.ico') {
      res.statusCode = 204;
      res.end();
      return;
    }
    const file = path.join(DIST, path.basename(url));
    if (!existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

async function open(): Promise<{ page: Page; posted: () => Promise<any[]>; send: (m: unknown) => Promise<void>; violations: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1700, height: 950 } });
  const violations: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy|Refused/i.test(m.text())) violations.push(m.text());
  });
  page.on('pageerror', (e) => violations.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    (window as any).__posted = [];
    (window as any).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => (window as any).__posted.push(m) });
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${(e as SecurityPolicyViolationEvent).violatedDirective} ${(e as SecurityPolicyViolationEvent).blockedURI}`));
  });
  await page.goto(origin);
  await page.waitForFunction(() => (window as any).__posted.some((m: any) => m.type === 'ready'));
  return {
    page,
    violations,
    posted: () => page.evaluate(() => (window as any).__posted),
    send: async (m) => {
      await page.evaluate((msg) => void window.dispatchEvent(new MessageEvent('message', { data: msg })), m);
    },
  };
}

/** Press "Fit Graph" and wait until exactly this many nodes/edges are in the DOM (off-screen elements are virtualized). */
async function showAll(page: Page, nodes: number, edges: number): Promise<void> {
  await page.locator('.toolbar').getByRole('button', { name: 'Fit Graph' }).click();
  await page.waitForFunction(([n, e]) => document.querySelectorAll('.gnode').length === n && document.querySelectorAll('.react-flow__edge').length === e, [nodes, edges], { timeout: 10_000 });
}

describe.skipIf(!CHROME)('webview in a real browser (strict CSP)', async () => {
  const { graph } = await analyzeFixture('react-express');
  const index = new GraphIndex(graph);
  const endpoints = listEndpoints(graph);

  it('shows the empty state, then endpoints, validates messages and sends scan requests', async () => {
    const { page, posted, send, violations } = await open();
    await page.getByText('No analysis yet').waitFor();
    await send({ type: 'state', hasAnalysis: true, scanning: false, stats: { files: 19, nodes: graph.nodes.length, edges: graph.edges.length, endpoints: 7, unresolved: 5, diagnostics: 3 } });
    await send({ type: 'endpoints', endpoints });
    await page.getByText('Pick an endpoint').waitFor();
    // the endpoint list lives only in the sidebar tree; the graph page must not repeat it
    expect(await page.locator('.endpoint-list').count()).toBe(0);
    expect(await page.getByPlaceholder('Search method, path or file…').count()).toBe(0);
    await page.getByText('API Flow Explorer sidebar').waitFor();

    // malformed host messages are ignored, not rendered
    await send({ type: 'subgraph', nodes: 'nope' });
    await send({ type: 'evil', html: '<img src=x onerror=alert(1)>' });
    expect(await page.locator('img').count()).toBe(0);

    // the Filters tab offers the methods/frameworks present in the analysis
    await page.locator('.dock').getByRole('tab', { name: 'Filters' }).click();
    await page.locator('.dock').getByLabel('DELETE', { exact: true }).waitFor();
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);

  it('renders a real endpoint flow, opens source on click, filters and expands', async () => {
    const { page, posted, send, violations } = await open();
    const ep = endpoints.find((e) => e.method === 'GET' && e.path === '/api/users')!;
    const sub = focusView(index, ep.id, 4)!;
    await send({ type: 'state', hasAnalysis: true, scanning: false });
    await send({ type: 'endpoints', endpoints });
    await send({ type: 'subgraph', nodes: sub.nodes, edges: sub.edges, hidden: sub.hidden, truncated: sub.truncated, focusId: ep.id });
    await page.locator('.gnode').first().waitFor();
    // automatic fit keeps a readable zoom, so far-away nodes are virtualized; "Fit Graph" shows everything
    await showAll(page, sub.nodes.length, sub.edges.length);
    // different shapes/categories are present
    for (const cat of ['cat-api', 'cat-backend', 'cat-data', 'cat-frontend']) expect(await page.locator(`.gnode.${cat}`).count()).toBeGreaterThan(0);

    // click-to-source: clicking a node asks the host to open that node (by id, never by path)
    await page.locator('.gnode[data-kind="service"], .gnode[data-kind="function"]').filter({ hasText: 'findAll' }).first().click();
    const openMsg = (await posted()).find((m: any) => m.type === 'openNode');
    expect(openMsg).toEqual({ type: 'openNode', nodeId: 'sym:server/services/userService.ts#findAll' });
    await page.getByRole('button', { name: 'Open Source' }).waitFor();
    await page.getByText('Incoming', { exact: false }).first().waitFor();

    // node-type filter hides nodes and their edges (Node Types dropdown in the Filters tab)
    const dock = page.locator('.dock');
    await dock.getByRole('tab', { name: 'Filters' }).click();
    const modelNodes = sub.nodes.filter((n) => n.kind === 'model').length;
    expect(modelNodes).toBeGreaterThan(0);
    await dock.getByRole('button', { name: /^Node Types: All selected/ }).click();
    await dock.getByRole('group', { name: 'Node Types' }).getByLabel('Model', { exact: true }).uncheck();
    await page.waitForFunction((n) => document.querySelectorAll('.gnode').length < n, sub.nodes.length);
    await dock.getByRole('group', { name: 'Node Types' }).getByLabel('Model', { exact: true }).check();
    await page.keyboard.press('Escape');
    await showAll(page, sub.nodes.length, sub.edges.length);

    // confidence filter removes edges of that confidence
    const highEdges = sub.edges.filter((e) => e.confidence === 'high').length;
    expect(highEdges).toBeGreaterThan(0);
    await dock.getByRole('button', { name: /^Confidence: All selected/ }).click();
    await dock.getByRole('group', { name: 'Confidence' }).getByLabel('High', { exact: true }).uncheck();
    await page.waitForFunction((n) => document.querySelectorAll('.react-flow__edge').length <= n, sub.edges.length - highEdges);
    await dock.getByRole('group', { name: 'Confidence' }).getByLabel('High', { exact: true }).check();
    await page.keyboard.press('Escape');
    await showAll(page, sub.nodes.length, sub.edges.length);

    // expand control on a node with hidden relationships
    const shallow = focusView(index, ep.id, 1)!;
    await send({ type: 'subgraph', nodes: shallow.nodes, edges: shallow.edges, hidden: shallow.hidden, truncated: false, focusId: ep.id });
    const expand = page.locator('.expand.down').first();
    await expand.waitFor();
    await expand.click();
    expect((await posted()).filter((m: any) => m.type === 'expand').at(-1)).toMatchObject({ direction: 'downstream', depth: 1 });

    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await send({ type: 'subgraph', nodes: sub.nodes, edges: sub.edges, hidden: sub.hidden, truncated: false, focusId: ep.id });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(SHOTS, 'endpoint-flow.png') });
    }
    expect(violations).toEqual([]);
    await page.close();
  }, 90_000);

  it('allows moving nodes by dragging, preserves position on selection, and supports auto layout', async () => {
    const { page, send, violations } = await open();
    const ep = endpoints.find((e) => e.method === 'GET' && e.path === '/api/users')!;
    const sub = focusView(index, ep.id, 2)!;
    await send({ type: 'state', hasAnalysis: true, scanning: false });
    await send({ type: 'endpoints', endpoints });
    await send({ type: 'subgraph', nodes: sub.nodes, edges: sub.edges, hidden: sub.hidden, truncated: false, focusId: ep.id });
    await page.locator('.gnode').first().waitFor();
    await showAll(page, sub.nodes.length, sub.edges.length);
    await page.waitForTimeout(300);

    const nodeWrapper = page.locator(`.react-flow__node[data-id="${ep.id}"]`);
    const targetNode = nodeWrapper.locator('.gnode');
    const transformBefore = await nodeWrapper.evaluate((el) => el.style.transform);
    const boxBefore = await targetNode.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Drag the node by 150px right, 100px down
    await page.mouse.move(boxBefore!.x + 30, boxBefore!.y + 20);
    await page.mouse.down();
    await page.mouse.move(boxBefore!.x + 180, boxBefore!.y + 120, { steps: 5 });
    await page.mouse.up();

    const transformAfter = await nodeWrapper.evaluate((el) => el.style.transform);
    expect(transformAfter).not.toBe(transformBefore);

    // Clicking the node updates selection in details panel without snapping position back
    await targetNode.click();
    const transformAfterClick = await nodeWrapper.evaluate((el) => el.style.transform);
    expect(transformAfterClick).toBe(transformAfter);

    // Auto layout button restores clean layout coordinates
    await page.getByRole('button', { name: 'Auto Layout' }).click();
    await page.waitForTimeout(100);
    const transformReset = await nodeWrapper.evaluate((el) => el.style.transform);
    expect(transformReset).toBe(transformBefore);

    expect(violations).toEqual([]);
    await page.close();
  });

  it('filters, legend and trace live in a collapsible dock below the graph; filters are shared with the host', async () => {
    const { page, posted, send, violations } = await open();
    const ep = endpoints.find((e) => e.method === 'GET' && e.path === '/api/users')!;
    const sub = focusView(index, ep.id, 3)!;
    await send({ type: 'state', hasAnalysis: true, scanning: false });
    await send({ type: 'endpoints', endpoints });
    await send({ type: 'subgraph', nodes: sub.nodes, edges: sub.edges, hidden: sub.hidden, truncated: false, focusId: ep.id });
    await page.locator('.gnode').first().waitFor();

    expect(await page.locator('.sidebar').count()).toBe(0);
    const canvas = await page.locator('.canvas').boundingBox();
    const dock = page.locator('.dock');
    const dockBox = (await dock.boundingBox())!;
    expect(dockBox.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height - 1); // below the graph
    expect(canvas!.x).toBeLessThan(5);

    // tabs: Filters | Legend | Trace Timeline (n)
    await dock.getByRole('tab', { name: 'Filters' }).waitFor();
    await dock.getByRole('tab', { name: /^Trace Timeline \(\d+\)$/ }).waitFor();
    await dock.getByRole('tab', { name: 'Legend' }).click();
    for (const heading of ['Node Types', 'Edge Types', 'Status']) await dock.getByText(heading, { exact: true }).waitFor();

    // filters: methods, frameworks, node types, confidence; every change is relayed to the host
    await dock.getByRole('tab', { name: 'Filters' }).click();
    for (const legend of ['HTTP Method', 'Framework']) await dock.getByText(legend, { exact: true }).waitFor();
    await dock.getByRole('button', { name: /^Node Types: All selected \(\d+\)$/ }).waitFor();
    await dock.getByLabel('DELETE', { exact: true }).uncheck();
    await dock.locator('.dock-badge').waitFor(); // badge counts active filter groups
    expect(await dock.locator('.dock-badge').innerText()).toBe('1');
    const sent = (await posted()).filter((m: any) => m.type === 'setFilters').at(-1);
    expect(sent.filters.methods).not.toContain('DELETE');
    expect(sent.filters.methods.length).toBeGreaterThan(0);

    // the host pushes filters changed in the sidebar: the form follows
    await send({ type: 'filters', filters: { query: '', category: 'all', methods: [], frameworks: [], hiddenKinds: [], hiddenConfidence: [] } });
    await page.waitForFunction(() => document.querySelectorAll('.dock-badge').length === 0);
    expect(await dock.getByLabel('DELETE', { exact: true }).isChecked()).toBe(true);
    await dock.getByLabel('DELETE', { exact: true }).uncheck();
    await dock.getByRole('button', { name: 'Reset Filters' }).click();
    expect(await dock.getByLabel('DELETE', { exact: true }).isChecked()).toBe(true);
    expect(await dock.locator('.dock-badge').count()).toBe(0);

    // collapse gives the graph its space back; a tab reopens it
    const heightWithDock = (await page.locator('.canvas').boundingBox())!.height;
    await dock.getByRole('button', { name: 'Collapse panel' }).click();
    expect(await dock.locator('.dock-body').count()).toBe(0);
    await page.waitForFunction((h) => (document.querySelector('.canvas') as HTMLElement).getBoundingClientRect().height > h, heightWithDock);
    await dock.getByRole('tab', { name: 'Legend' }).click();
    await dock.locator('.dock-body').waitFor();
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);

  it('details panel: endpoint metadata, tabs, trace, close / widen / reopen; export menu; graph lock', async () => {
    const { page, posted, send, violations } = await open();
    const ep = endpoints.find((e) => e.method === 'GET' && e.path === '/api/users')!;
    const sub = focusView(index, ep.id, 3)!;
    await send({ type: 'state', hasAnalysis: true, scanning: false, stats: { files: 5, nodes: 10, edges: 12, endpoints: 7, unresolved: 1, diagnostics: 2 } });
    await send({ type: 'endpoints', endpoints });
    await send({ type: 'subgraph', nodes: sub.nodes, edges: sub.edges, hidden: sub.hidden, truncated: false, focusId: ep.id });
    await page.locator('.gnode').first().waitFor();
    await page.locator(`.react-flow__node[data-id="${ep.id}"] .gnode`).click();

    const panel = page.locator('.details-panel');
    await panel.getByRole('heading', { name: 'Endpoint Details' }).waitFor();
    for (const label of ['File', 'Line', 'Framework']) await panel.locator('.dp-rows').getByText(label, { exact: true }).waitFor();
    for (const label of ['Method', 'Path', 'Handler']) await panel.locator('.dp-meta').getByText(label, { exact: true }).waitFor();
    await panel.getByRole('heading', { name: 'Related Nodes' }).waitFor();
    await panel.getByText('Relationships & evidence').waitFor();
    await page.locator('.stats').getByText('5 files').waitFor();

    // Trace is static: derived from source, never presented as a runtime observation
    await panel.getByRole('tab', { name: 'Trace' }).click();
    await panel.getByText(/static|source/i).first().waitFor();
    await panel.getByRole('tab', { name: 'Details' }).click();

    // widen / close / reopen
    const narrow = (await panel.boundingBox())!.width;
    await panel.getByRole('button', { name: 'Widen panel' }).click();
    await page.waitForFunction((w) => (document.querySelector('.details-panel') as HTMLElement).getBoundingClientRect().width > w + 20, narrow);
    await panel.getByRole('button', { name: 'Close details' }).click();
    expect(await page.locator('.details-panel').count()).toBe(0);
    await page.getByRole('button', { name: /Details/ }).click();
    await page.locator('.details-panel').waitFor();

    // export menu: Mermaid for the visible flow, Markdown / JSON for the analysis
    const toolbar = page.getByRole('toolbar', { name: 'Graph toolbar' });
    await toolbar.getByRole('button', { name: /Export/ }).click();
    await page.getByRole('menuitem', { name: /Markdown/ }).click();
    expect((await posted()).filter((m: any) => m.type === 'exportAction').at(-1)).toEqual({ type: 'exportAction', action: 'markdown' });
    await toolbar.getByRole('button', { name: /Export/ }).click();
    await page.getByRole('menuitem', { name: /JSON/ }).click();
    expect((await posted()).filter((m: any) => m.type === 'exportAction').at(-1)).toEqual({ type: 'exportAction', action: 'json' });
    await toolbar.getByRole('button', { name: /Export/ }).click();
    await page.getByRole('menuitem', { name: /Mermaid/ }).click();
    expect((await posted()).filter((m: any) => m.type === 'exportMermaid').at(-1).nodeIds.length).toBe(sub.nodes.length);

    // edge labels are shown as pills
    expect(await page.locator('.react-flow__edge-textwrapper, .react-flow__edge-text').count()).toBeGreaterThan(0);
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);

  it('API tester body editor: JSON by default for POST, auto-format on paste/blur, smart typing', async () => {
    const { page, posted, send, violations } = await open();
    const ep = endpoints.find((e) => e.method === 'POST' && e.path === '/api/users')!;
    const sub = focusView(index, ep.id, 2)!;
    await send({ type: 'state', hasAnalysis: true, scanning: false });
    await send({ type: 'endpoints', endpoints });
    await send({ type: 'subgraph', nodes: sub.nodes, edges: sub.edges, hidden: sub.hidden, truncated: false, focusId: ep.id });
    await page.locator(`.react-flow__node[data-id="${ep.id}"] .gnode`).click();
    await page.getByRole('tab', { name: 'API Tester' }).click();
    await page.getByLabel('API Request Tester').waitFor();

    // opening the Body tab of a POST request selects JSON for you
    await page.locator('.tester-tabs').getByRole('button', { name: /^Body/ }).click();
    await page.getByRole('radio', { name: 'JSON' }).waitFor();
    expect(await page.getByRole('radio', { name: 'JSON' }).isChecked()).toBe(true);
    const box = page.getByLabel('Request body');
    expect(await box.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(200); // roomy editor

    // typing: auto-close, smart Enter, step over closers
    await box.click();
    await page.keyboard.type('{');
    await page.keyboard.press('Enter');
    await page.keyboard.type('"name": "Ann"');
    expect(await box.inputValue()).toBe('{\n  "name": "Ann"\n}');

    // paste a JS object over everything: formatted automatically
    await page.keyboard.press('Control+A');
    await box.evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData('text', "{ id: 7, tags: ['a','b',], // note\n nested: { ok: true } }");
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Request body"]') as HTMLTextAreaElement).value.includes('"id": 7'));
    expect(JSON.parse(await box.inputValue())).toEqual({ id: 7, tags: ['a', 'b'], nested: { ok: true } });
    expect(await box.inputValue()).toContain('\n  "tags": [');
    await page.getByText('Valid JSON').waitFor();

    // leaving the editor formats too
    await box.fill('{x:1,}');
    await page.getByText('will be cleaned up automatically').waitFor();
    await page.locator('.base-url-input').click();
    await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Request body"]') as HTMLTextAreaElement).value === '{\n  "x": 1\n}');

    // real syntax errors point at the line and are not "fixed"
    await box.fill('{\n  "a": 1\n  "b": 2\n}');
    await page.getByText(/line 3/).waitFor();

    // Ctrl+Enter sends
    await box.fill('{"ok":true}');
    await box.press('Control+Enter');
    const exec = (await posted()).filter((m: any) => m.type === 'executeRequest').at(-1);
    expect(exec.request).toMatchObject({ method: 'POST', body: { type: 'json' } });
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);

  it('supports interactive API testing panel with request execution and response display', async () => {
    const { page, posted, send, violations } = await open();
    const ep = endpoints.find((e) => e.method === 'GET' && e.path === '/api/users')!;
    const sub = focusView(index, ep.id, 2)!;
    await send({ type: 'state', hasAnalysis: true, scanning: false });
    await send({ type: 'endpoints', endpoints });
    await send({ type: 'subgraph', nodes: sub.nodes, edges: sub.edges, hidden: sub.hidden, truncated: false, focusId: ep.id });
    await page.locator('.gnode').first().waitFor();

    // Select endpoint node and open the API Tester tab of the details panel
    await page.locator(`.react-flow__node[data-id="${ep.id}"] .gnode`).click();
    const testReqBtn = page.getByRole('tab', { name: 'API Tester' });
    await testReqBtn.waitFor();
    await testReqBtn.click();

    // API Tester panel should now be active
    await page.getByLabel('API Request Tester').waitFor();

    // it opens as a full page: graph hidden, request and response side by side, wide enough to work in
    await page.getByLabel('API Tester page').waitFor();
    expect(await page.locator('.canvas').isVisible()).toBe(false);
    const pageBox = (await page.locator('.tester-page').boundingBox())!;
    const reqBox = (await page.locator('.tester-request').boundingBox())!;
    const resBox = (await page.locator('.response-section').boundingBox())!;
    expect(pageBox.width).toBeGreaterThan(1500);
    expect(reqBox.width).toBeGreaterThan(600);
    expect(resBox.x).toBeGreaterThan(reqBox.x + reqBox.width - 1); // response is to the right of the request
    expect(await page.locator('.url-input').inputValue()).toBe('{{baseUrl}}/api/users');

    // Add a query parameter
    await page.getByRole('button', { name: '+ Add Query Param' }).click();
    const keyInput = page.locator('.params-tab input[placeholder="Key"]').last();
    const valInput = page.locator('.params-tab input[placeholder="Value"]').last();
    await keyInput.fill('active');
    await valInput.fill('true');

    // one base URL for every API: edits are sent to the host (remembered per workspace) and host-pushed values show up
    await page.getByLabel(/^Base URL/).fill('https://api.example.com/v2');
    expect((await posted()).filter((m: any) => m.type === 'setBaseUrl').at(-1)).toEqual({ type: 'setBaseUrl', value: 'https://api.example.com/v2' });
    await page.locator('.preview-url-hint').getByText('https://api.example.com/v2/api/users').waitFor();
    await send({ type: 'baseUrl', value: 'http://localhost:4000' });
    await page.waitForFunction(() => (document.querySelector('#base-url-input') as HTMLInputElement).value === 'http://localhost:4000');

    // Click Send
    const sendBtn = page.getByRole('button', { name: '▶ Send' });
    await sendBtn.click();

    // Verify executeRequest message was posted to host
    const execMsg = (await posted()).find((m: any) => m.type === 'executeRequest');
    expect(execMsg).toBeDefined();
    expect(execMsg.request.method).toBe('GET');
    expect(execMsg.request.queryParams).toContainEqual({ key: 'active', value: 'true', enabled: true });

    // Host responds with requestStarted then requestFinished
    await send({ type: 'requestStarted', requestId: execMsg.request.id });
    await send({
      type: 'requestFinished',
      response: {
        requestId: execMsg.request.id,
        status: 200,
        statusText: 'OK',
        durationMs: 38,
        sizeBytes: 245,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-xyz' },
        body: JSON.stringify([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }], null, 2),
        isJson: true,
        truncated: false,
        timing: { start: Date.now() - 38, end: Date.now() },
      },
    });

    // Verify response metrics and body rendered
    await page.locator('.status-pill.status-2xx').waitFor();
    expect(await page.locator('.status-pill').textContent()).toContain('200 OK');
    expect(await page.locator('.response-pre').textContent()).toContain('"Alice"');

    // Verify Headers tab in response viewer
    await page.getByRole('button', { name: /Headers\s*\(\d+\)/ }).click();
    expect(await page.locator('.res-headers-table').textContent()).toContain('x-request-id');

    expect(violations).toEqual([]);
    await page.close();
  });

  it('marks unresolved relationships and explains them in the details panel', async () => {
    const { page, send, violations } = await open();
    const unresolved = graph.edges.find((e) => e.kind === 'http-request' && e.resolution === 'unresolved' && /does-not-exist/.test(e.reason ?? ''))!;
    const ids = new Set([unresolved.source, unresolved.target]);
    const nodes = graph.nodes.filter((n) => ids.has(n.id));
    await send({ type: 'state', hasAnalysis: true, scanning: false });
    await send({ type: 'subgraph', nodes, edges: [unresolved], hidden: {}, truncated: false, focusId: unresolved.source });
    await page.locator('.badge-unresolved').first().waitFor();
    await page.locator('.gnode[data-kind="unknown"]').click();
    await page.locator('.details-panel').getByText('Unresolved:', { exact: false }).waitFor();
    await page.locator('.react-flow__edge').first().click({ force: true });
    await page.locator('.details-panel').getByText('Why not fully resolved:', { exact: false }).waitFor();
    expect(await page.locator('.details-panel').getByText(/no endpoint matches GET \/api\/does-not-exist/).count()).toBeGreaterThan(0);
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);

  it('renders a large graph within a reasonable time', async () => {
    const { page, send, violations } = await open();
    const N = 300;
    const nodes = Array.from({ length: N }, (_, i) => ({ id: `n${i}`, kind: i % 5 === 0 ? 'service' : 'function', name: `fn${i}`, path: `src/f${i % 40}.ts`, startLine: i + 1, metadata: {} }));
    const edges = Array.from({ length: N - 1 }, (_, i) => ({
      id: `e${i}`, source: `n${Math.floor(i / 2)}`, target: `n${i + 1}`, kind: 'calls', confidence: 'high', resolution: 'resolved', evidence: { path: 'src/a.ts', line: 1, explanation: 'synthetic' },
    }));
    await send({ type: 'state', hasAnalysis: true, scanning: false });
    const t0 = Date.now();
    await send({ type: 'subgraph', nodes, edges, hidden: {}, truncated: true, focusId: 'n0' });
    await page.locator('.gnode').first().waitFor();
    const elapsed = Date.now() - t0;
    console.info(`[perf] 300-node graph rendered (layout + first paint) in ${elapsed} ms`);
    expect(elapsed).toBeLessThan(8000);
    expect(await page.getByText('truncated').count()).toBeGreaterThan(0);
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);
});

describe.skipIf(!CHROME)('graph node rendering (layout regressions)', async () => {
  const { graph } = await analyzeFixture('react-express');
  const index = new GraphIndex(graph);
  const eps = listEndpoints(graph);

  it('draws a visible border, keeps text clear of the connection handles and badges off the header', async () => {
    const { page, send } = await open();
    const ep = eps.find((e) => e.method === 'GET' && e.path === '/api/users')!;
    const sub = focusView(index, ep.id, 1)!; // depth 1 leaves hidden relationships, so expand badges exist
    await send({ type: 'state', hasAnalysis: true, scanning: false });
    await send({ type: 'subgraph', nodes: sub.nodes, edges: sub.edges, hidden: sub.hidden, truncated: false, focusId: ep.id });
    await page.locator('.gnode').first().waitFor();
    await page.locator('.toolbar').getByRole('button', { name: 'Fit Graph' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('.gnode').length === n, sub.nodes.length);

    const report = await page.evaluate(() => {
      const out: string[] = [];
      for (const n of document.querySelectorAll<HTMLElement>('.gnode')) {
        const cs = getComputedStyle(n);
        const kind = n.dataset.kind;
        if (cs.borderTopStyle === 'none' || parseFloat(cs.borderTopWidth) < 1) out.push(`${kind}: border not drawn`);
        const box = n.getBoundingClientRect();
        const name = n.querySelector<HTMLElement>('.gnode-name')!.getBoundingClientRect();
        const head = n.querySelector<HTMLElement>('.gnode-head')!.getBoundingClientRect();
        for (const h of n.querySelectorAll<HTMLElement>('.react-flow__handle')) {
          const hb = h.getBoundingClientRect();
          const horizontalOverlap = hb.right > name.left + 1 && hb.left < name.right - 1;
          const verticalOverlap = hb.bottom > name.top && hb.top < name.bottom;
          // the handle may poke 4px into the card but must stay left/right of the name text
          if (horizontalOverlap && verticalOverlap && (hb.right > name.left + 1 && hb.left < name.left + 1)) out.push(`${kind}: handle covers the first letters`);
          if (hb.left < name.right && hb.right > name.right - 2 && verticalOverlap) out.push(`${kind}: handle covers the last letters`);
        }
        for (const b of n.querySelectorAll<HTMLElement>('.expand')) {
          const eb = b.getBoundingClientRect();
          if (eb.bottom > head.top + 2 && eb.top < head.bottom && eb.right > head.left && eb.left < head.right && eb.bottom > box.top + 1 && eb.top < box.bottom - 1) out.push(`${kind}: expand badge covers the header`);
        }
        if (n.dataset.kind && Math.abs(box.width - 250 * (box.width / n.offsetWidth)) > 2) out.push(`${kind}: width is not the layout width`);
      }
      return out;
    });
    expect(report).toEqual([]);
    expect(await page.locator('.expand').count()).toBeGreaterThan(0);
    await page.close();
  }, 60_000);
});

describe.skipIf(!CHROME)('API tester full page', async () => {
  const { graph } = await analyzeFixture('react-express');
  const index = new GraphIndex(graph);
  const eps = listEndpoints(graph);

  it('"Back to graph" returns to the same graph; the details tab opens the tester as a page too', async () => {
    const { page, send, violations } = await open();
    const ep = eps.find((e) => e.method === 'GET' && e.path === '/api/users')!;
    const sub = focusView(index, ep.id, 2)!;
    await send({ type: 'state', hasAnalysis: true, scanning: false });
    await send({ type: 'subgraph', nodes: sub.nodes, edges: sub.edges, hidden: sub.hidden, truncated: false, focusId: ep.id });
    await page.locator('.gnode').first().waitFor();
    await showAll(page, sub.nodes.length, sub.edges.length); // off-screen nodes are virtualized: compare the full graph
    expect(await page.locator('.tester-page').count()).toBe(0);

    await page.getByRole('tab', { name: /API Tester/ }).click();
    await page.getByLabel('API Tester page').waitFor();
    expect(await page.locator('.app').isVisible()).toBe(false);
    expect(await page.getByLabel('API Request Tester').count()).toBe(1); // rendered once, not also in the side column

    if (SHOTS) {
      await page.getByRole('button', { name: '+ Add Query Param' }).waitFor();
      await page.screenshot({ path: path.join(SHOTS, 'api-tester-page.png') });
    }
    await page.getByRole('button', { name: '← Back to graph' }).click();
    await page.locator('.canvas').waitFor({ state: 'visible' });
    expect(await page.locator('.tester-page').count()).toBe(0);
    await showAll(page, sub.nodes.length, sub.edges.length); // graph state kept
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);
});

describe.skipIf(!CHROME)('code editor look and feel', async () => {
  const { graph } = await analyzeFixture('react-express');
  const index = new GraphIndex(graph);
  const eps = listEndpoints(graph);

  async function openBody() {
    const ctx = await open();
    const ep = eps.find((e) => e.method === 'POST' && e.path === '/api/users')!;
    const sub = focusView(index, ep.id, 2)!;
    await ctx.send({ type: 'state', hasAnalysis: true, scanning: false });
    await ctx.send({ type: 'subgraph', nodes: sub.nodes, edges: sub.edges, hidden: sub.hidden, truncated: false, focusId: ep.id });
    await ctx.page.locator(`.react-flow__node[data-id="${ep.id}"] .gnode`).click();
    await ctx.page.getByRole('tab', { name: 'API Tester' }).click();
    await ctx.page.locator('.tester-tabs').getByRole('button', { name: /^Body/ }).click();
    await ctx.page.getByLabel('Request body').waitFor();
    return ctx;
  }

  it('colours tokens, shows line numbers, highlights the current line and matching brackets', async () => {
    const { page, violations } = await openBody();
    const box = page.getByLabel('Request body');
    await box.fill('{\n  "name": "Ann",\n  "age": 41,\n  "ok": true,\n  "tok": {{token}},\n  "tags": ["a"]\n}');
    await page.locator('.code-pre .tok-key').first().waitFor();

    const colour = (sel: string) => page.locator(`.code-pre ${sel}`).first().evaluate((el) => getComputedStyle(el).color);
    const colours = [await colour('.tok-key'), await colour('.tok-string'), await colour('.tok-number'), await colour('.tok-literal'), await colour('.tok-variable'), await colour('.tok-bracket.bracket-0')];
    expect(new Set(colours).size).toBe(colours.length); // every token kind has its own colour
    expect(await page.locator('.code-pre .tok-key').allInnerTexts()).toEqual(['"name"', '"age"', '"ok"', '"tok"', '"tags"']);

    // gutter: one number per line, active line follows the caret
    expect(await page.locator('.code-ln').count()).toBe(7);
    await box.click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('.code-ln.active')?.textContent === '3');

    // matching bracket: caret right after the opening brace highlights both braces
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelectorAll('.code-bracket-match').length === 2);

    // the highlight layer sits exactly under the textarea text (same metrics): first glyph rects coincide
    const aligned = await page.evaluate(() => {
      const ta = document.querySelector('.code-input') as HTMLTextAreaElement;
      const pre = document.querySelector('.code-pre') as HTMLElement;
      const a = ta.getBoundingClientRect();
      const b = pre.getBoundingClientRect();
      const cs1 = getComputedStyle(ta);
      const cs2 = getComputedStyle(pre);
      return { dx: Math.abs(a.left - b.left), dy: Math.abs(a.top - b.top), same: ['fontFamily', 'fontSize', 'lineHeight', 'paddingLeft', 'paddingTop', 'tabSize'].every((k) => (cs1 as any)[k] === (cs2 as any)[k]) };
    });
    expect(aligned.same).toBe(true);
    expect(aligned.dx).toBeLessThan(1);
    expect(aligned.dy).toBeLessThan(1);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'code-editor.png') });
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);

  it('scrolls gutter and highlight together with the text, and marks the error line', async () => {
    const { page, violations } = await openBody();
    const box = page.getByLabel('Request body');
    const long = '{\n' + Array.from({ length: 80 }, (_, i) => `  "k${i}": ${i},`).join('\n') + '\n  "bad" 1\n}';
    await box.fill(long);
    await page.locator('.code-ln.error').waitFor();
    expect(await page.locator('.code-ln.error').innerText()).toBe('82'); // { is line 1, 80 keys are 2-81, the broken line is 82
    await page.locator('.code-line-error').waitFor();

    await box.evaluate((el) => { (el as HTMLTextAreaElement).scrollTop = 400; el.dispatchEvent(new Event('scroll')); });
    const t = await page.evaluate(() => ({
      layer: getComputedStyle(document.querySelector('.code-layer-inner')!).transform,
      gutter: getComputedStyle(document.querySelector('.code-gutter-inner')!).transform,
    }));
    expect(t.layer).toBe('matrix(1, 0, 0, 1, 0, -400)');
    expect(t.gutter).toBe('matrix(1, 0, 0, 1, 0, -400)');
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);

  it('shows JSON responses pretty-printed and coloured; non-JSON stays as received', async () => {
    const { page, send, violations } = await openBody();
    const base = { requestId: 'r1', statusText: 'OK', durationMs: 5, sizeBytes: 40, headers: {}, truncated: false, timing: { start: 0, end: 5 } };
    await send({ type: 'requestFinished', response: { ...base, status: 200, isJson: true, body: '{"data":{"id":7,"name":"Ann","ok":true,"tags":["a","b"]}}' } });
    await page.locator('.response-pre .tok-key').first().waitFor();
    const text = await page.locator('.response-pre code').innerText();
    expect(text).toBe('{\n  "data": {\n    "id": 7,\n    "name": "Ann",\n    "ok": true,\n    "tags": [\n      "a",\n      "b"\n    ]\n  }\n}');
    const c = (sel: string) => page.locator(`.response-pre ${sel}`).first().evaluate((el) => getComputedStyle(el).color);
    expect(new Set([await c('.tok-key'), await c('.tok-string'), await c('.tok-number'), await c('.tok-literal')]).size).toBe(4);

    await send({ type: 'requestFinished', response: { ...base, status: 200, isJson: false, body: '<html>not json</html>' } });
    await page.waitForFunction(() => document.querySelector('.response-pre code')?.textContent === '<html>not json</html>');
    expect(await page.locator('.response-pre .tok-key').count()).toBe(0);
    expect(violations).toEqual([]);
    await page.close();
  }, 30_000);
});

describe.skipIf(!CHROME)('API tester pre-filled from the endpoint schema', async () => {
  const { graph } = await analyzeFixture('request-schemas');
  const index = new GraphIndex(graph);
  const eps = listEndpoints(graph);

  it('opens with path variables, query keys and a body skeleton; the user only adds values and sends', async () => {
    const { page, posted, send, violations } = await open();
    const ep = eps.find((e) => e.method === 'PATCH' && e.path === '/users/:id')!;
    const sub = focusView(index, ep.id, 1)!;
    await send({ type: 'state', hasAnalysis: true, scanning: false });
    await send({ type: 'subgraph', nodes: sub.nodes, edges: sub.edges, hidden: sub.hidden, truncated: false, focusId: ep.id });
    await page.locator(`.react-flow__node[data-id="${ep.id}"] .gnode`).click();
    await page.getByRole('tab', { name: 'API Tester' }).click();
    await page.getByLabel('API Tester page').waitFor();

    // path variable: the key is listed, the user types the value, the target URL follows
    await page.getByLabel('Path variable id').waitFor();
    expect(await page.getByLabel('Path variable id').inputValue()).toBe(':id');
    expect(await page.getByLabel('Value for id').getAttribute('placeholder')).toBe('number · required');
    await page.getByLabel('Value for id').fill('42');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'tester-prefilled-params.png') });
    await page.locator('.preview-url-hint').getByText('/users/42').waitFor();

    // body: every key of the DTO is present with an empty value of the right type
    await page.locator('.tester-tabs').getByRole('button', { name: /^Body/ }).click();
    const text = await page.getByLabel('Request body').inputValue();
    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(['address', 'age', 'email', 'nickname', 'role', 'tags']);
    expect(body.address).toEqual({ street: '', zip: '' });
    expect(await page.getByRole('radio', { name: 'JSON' }).isChecked()).toBe(true);

    // the user fills a value and sends
    await page.getByLabel('Request body').fill(JSON.stringify({ ...body, email: 'a@b.co' }, null, 2));
    await page.getByRole('button', { name: '▶ Send' }).click();
    const exec = (await posted()).filter((m: any) => m.type === 'executeRequest').at(-1);
    expect(exec.request.method).toBe('PATCH');
    expect(exec.request.pathParams).toEqual([expect.objectContaining({ key: 'id', value: '42' })]);
    expect(JSON.parse(exec.request.body.content).email).toBe('a@b.co');

    // query params: required ones are on, optional ones are listed but off
    await page.locator('.tester-page-bar').getByRole('button', { name: '← Back to graph' }).click();
    const listEp = eps.find((e) => e.method === 'GET' && e.path === '/users')!;
    const listSub = focusView(index, listEp.id, 1)!;
    await send({ type: 'subgraph', nodes: listSub.nodes, edges: listSub.edges, hidden: listSub.hidden, truncated: false, focusId: listEp.id });
    await page.locator(`.react-flow__node[data-id="${listEp.id}"] .gnode`).click();
    await page.getByRole('tab', { name: 'API Tester' }).click();
    await page.locator('.params-tab input[placeholder="Key"]').first().waitFor();
    const keys = await page.locator('.params-tab .kv-row input[placeholder="Key"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(keys).toEqual(['page', 'search', 'order']);
    const checked = await page.locator('.params-tab .kv-row input[type="checkbox"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).checked));
    expect(checked).toEqual([false, false, true]);
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);
});

describe.skipIf(!CHROME)('sidebar (branding, search, categories, groups, filters)', async () => {
  const { graph } = await analyzeFixture('react-express');
  const eps = listEndpoints(graph);
  const groups = sidebarGroups(graph);
  const state = (over: Record<string, unknown> = {}) => ({ type: 'state', hasAnalysis: true, scanning: false, endpoints: eps, groups, filters: defaultFilterState(), ...over });

  async function openSidebar() {
    const page = await browser.newPage({ viewport: { width: 380, height: 760 } });
    const violations: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || /Content Security Policy|Refused/i.test(m.text())) violations.push(m.text());
    });
    page.on('pageerror', (e) => violations.push(`pageerror: ${e.message}`));
    await page.addInitScript(() => {
      (window as any).__posted = [];
      let saved: unknown;
      (window as any).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => (window as any).__posted.push(m), getState: () => saved, setState: (s: unknown) => (saved = s) });
      document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${(e as SecurityPolicyViolationEvent).violatedDirective}`));
    });
    await page.goto(`${origin}/sidebar`);
    await page.waitForFunction(() => (window as any).__posted.some((m: any) => m.type === 'ready'));
    const send = (m: unknown) => page.evaluate((msg) => void window.dispatchEvent(new MessageEvent('message', { data: msg })), m);
    const posted = () => page.evaluate(() => (window as any).__posted as any[]);
    return { page, send, posted, violations };
  }

  it('shows branding, search, category pills with counts, collapsible groups and the filters; filters as you type', async () => {
    const { page, send, posted, violations } = await openSidebar();
    await page.getByRole('button', { name: 'Scan Workspace' }).waitFor(); // no analysis yet
    await page.getByRole('button', { name: 'Scan Workspace' }).click();
    expect((await posted()).at(-1)).toEqual({ type: 'scan' });
    await send(state());

    await page.getByRole('heading', { name: 'API Flow Explorer' }).waitFor();
    await page.locator('.af-group[data-group="endpoints"] .af-row').first().waitFor();
    const search = page.getByLabel('Search endpoints');
    await search.waitFor();
    expect(await page.locator('.af-group[data-group="endpoints"] .af-row').count()).toBe(eps.length);

    // pills: All / Frontend / Backend with counts (Next.js endpoints are frontend, everything else backend)
    const pill = (name: string) => page.locator('.af-pills').getByRole('button', { name: new RegExp(`^${name}`) });
    expect(await pill('All').innerText()).toContain(String(eps.length));
    await pill('Backend').click();
    expect((await posted()).filter((m: any) => m.type === 'setFilters').at(-1).filters.category).toBe('backend');
    await pill('Frontend').click();
    await page.getByText('Nothing matches.').first().waitFor(); // the react-express fixture has no Next.js endpoints
    await pill('All').click();

    // groups: Endpoints open, others collapsed until opened
    for (const title of ['Endpoints', 'Frontend Requests', 'Services', 'Models', 'External APIs']) await page.getByRole('button', { name: new RegExp(`^${title}`) }).waitFor();
    const services = page.locator('.af-group[data-group="services"]');
    await services.getByRole('button', { name: /^Services/ }).click();
    await services.locator('.af-list').waitFor();
    expect(await services.locator('.af-row').count()).toBe(groups.services.length);

    // badges: one colour per method
    await page.locator('.af-group[data-group="endpoints"] .af-row').first().waitFor();
    const colours = await page.locator('.af-group[data-group="endpoints"] .af-row .af-badge').evaluateAll((els) => Object.fromEntries(els.map((e) => [e.textContent, getComputedStyle(e).backgroundColor])));
    expect(new Set(Object.values(colours)).size).toBe(Object.keys(colours).length);
    expect(Object.keys(colours).sort()).toEqual(['DELETE', 'GET', 'POST', 'PUT']);

    // typing filters live and is relayed to the host (which forwards it to the graph page)
    const rows = page.locator('.af-group[data-group="endpoints"] .af-row');
    await search.fill('orders');
    expect(await rows.count()).toBe(2);
    await search.fill('delete orders');
    expect(await rows.count()).toBe(1);
    expect(await rows.first().locator('.af-path').innerText()).toBe('/api/orders/:orderId');
    expect((await posted()).filter((m: any) => m.type === 'setFilters').at(-1).filters.query).toBe('delete orders');

    // method checkboxes combine with the text
    await search.fill('');
    const filters = page.getByRole('region', { name: 'Filters' });
    await filters.getByLabel('GET', { exact: true }).uncheck();
    await filters.getByLabel('PUT', { exact: true }).uncheck();
    await filters.getByLabel('DELETE', { exact: true }).uncheck();
    expect(await rows.count()).toBe(eps.filter((e) => e.method === 'POST').length);
    await filters.getByRole('button', { name: 'Reset Filters' }).click();
    expect(await rows.count()).toBe(eps.length);
    await filters.getByRole('button', { name: /^Node Types: All selected/ }).waitFor();

    // node-type filter hides a whole group
    await filters.getByRole('button', { name: /^Node Types: All selected/ }).click();
    await filters.getByRole('group', { name: 'Node Types' }).getByLabel('API endpoint', { exact: true }).uncheck();
    expect(await rows.count()).toBe(0);
    await page.keyboard.press('Escape');
    await filters.getByRole('button', { name: 'Reset Filters' }).click();

    // clear button resets the search
    await search.fill('users');
    await page.getByRole('button', { name: 'Clear search' }).click();
    expect(await search.inputValue()).toBe('');
    expect(await rows.count()).toBe(eps.length);

    // click opens by id
    const target = eps.find((e) => e.method === 'PUT')!;
    await page.locator(`.af-row[data-id="${target.id}"]`).click();
    expect((await posted()).filter((m: any) => m.type === 'openEndpoint').at(-1)).toEqual({ type: 'openEndpoint', id: target.id });
    // other nodes are opened by id too
    const group = (['services', 'models', 'requests', 'externals'] as const).find((k) => groups[k].length > 0)!;
    const item = groups[group][0];
    const section = page.locator(`.af-group[data-group="${group}"]`);
    if ((await section.locator('.af-row').count()) === 0) await section.getByRole('button').first().click();
    await section.locator(`.af-row[data-id="${item.id}"]`).click();
    expect((await posted()).filter((m: any) => m.type === 'openItem').at(-1)).toEqual({ type: 'openItem', id: item.id });
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);

  it('follows filters pushed by the host (the graph page changed them) and toggles the filters section', async () => {
    const { page, send, violations } = await openSidebar();
    await send(state());
    const rows = page.locator('.af-group[data-group="endpoints"] .af-row');
    await rows.first().waitFor();
    await send({ type: 'filters', filters: { ...defaultFilterState(), query: 'orders', methods: ['DELETE'] } });
    await page.waitForFunction(() => (document.querySelector('input[aria-label="Search endpoints"]') as HTMLInputElement).value === 'orders');
    expect(await rows.count()).toBe(1);
    expect(await page.getByRole('region', { name: 'Filters' }).getByLabel('GET', { exact: true }).isChecked()).toBe(false);
    await page.getByRole('button', { name: 'Toggle filters' }).click();
    expect(await page.getByRole('region', { name: 'Filters' }).count()).toBe(0);
    await page.getByRole('button', { name: 'Toggle filters' }).click();
    await page.getByRole('region', { name: 'Filters' }).waitFor();
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);

  it('keyboard: Down moves into the list, arrows move, Enter opens, Escape clears, Enter in the box opens the first match', async () => {
    const { page, send, posted, violations } = await openSidebar();
    await send(state());
    const search = page.getByLabel('Search endpoints');
    await search.fill('users');
    await search.press('ArrowDown');
    expect(await page.evaluate(() => document.activeElement?.classList.contains('af-row'))).toBe(true);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const second = (await page.locator('.af-row').nth(1).getAttribute('data-id'))!;
    expect((await posted()).filter((m: any) => m.type === 'openEndpoint').at(-1)).toEqual({ type: 'openEndpoint', id: second });
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect(await page.evaluate(() => document.activeElement === document.querySelector('input[aria-label="Search endpoints"]'))).toBe(true);

    const first = (await page.locator('.af-row').first().getAttribute('data-id'))!;
    await search.press('Enter');
    expect((await posted()).filter((m: any) => m.type === 'openEndpoint').at(-1)).toEqual({ type: 'openEndpoint', id: first });
    await search.press('Escape');
    expect(await search.inputValue()).toBe('');
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);

  it('handles scanning, empty and no-match states; focusSearch; ignores malformed host messages', async () => {
    const { page, send, violations } = await openSidebar();
    await send(state({ hasAnalysis: false, scanning: true, endpoints: [] }));
    await page.getByText('Scanning workspace…').waitFor();
    await send(state({ endpoints: [], groups: { requests: [], services: [], models: [], externals: [] } }));
    await page.getByText('No API endpoints found').waitFor();
    await send(state());
    await page.getByLabel('Search endpoints').fill('zzz-nothing');
    await page.getByText('No results match the search and filters.').waitFor();

    await page.getByLabel('Search endpoints').fill('');
    await page.getByLabel('Search endpoints').evaluate((el) => (el as HTMLInputElement).blur());
    await send({ type: 'focusSearch' });
    expect(await page.evaluate(() => document.activeElement === document.querySelector('input[aria-label="Search endpoints"]'))).toBe(true);

    await send({ type: 'state', endpoints: 'nope' });
    await send({ type: 'evil', html: '<img src=x onerror=alert(1)>' });
    expect(await page.locator('img').count()).toBe(0);
    // endpoint text is rendered as text, never as markup
    await send(state({ endpoints: [{ id: 'x', method: 'GET', path: '/<img src=x onerror=alert(1)>', framework: 'express', file: 'a.ts', line: 1 }] }));
    await page.locator('.af-row').first().waitFor();
    expect(await page.locator('.af-row img').count()).toBe(0);
    expect(await page.locator('.af-row .af-path').first().innerText()).toBe('/<img src=x onerror=alert(1)>');
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);
});

describe.skipIf(!CHROME)('API tester follows the endpoint chosen in the sidebar', async () => {
  const { graph } = await analyzeFixture('request-schemas');
  const index = new GraphIndex(graph);
  const eps = listEndpoints(graph);

  it('clicking another endpoint while the tester page is open switches the tester to it', async () => {
    const { page, send, violations } = await open();
    const a = eps.find((e) => e.method === 'PATCH' && e.path === '/users/:id')!;
    const b = eps.find((e) => e.method === 'GET' && e.path === '/users/search')!;
    const view = (id: string) => {
      const v = focusView(index, id, 1)!;
      return { type: 'subgraph', nodes: v.nodes, edges: v.edges, hidden: v.hidden, truncated: false, focusId: id };
    };
    await send({ type: 'state', hasAnalysis: true, scanning: false });
    await send(view(a.id));
    await page.locator(`.react-flow__node[data-id="${a.id}"] .gnode`).click();
    await page.getByRole('tab', { name: 'API Tester' }).click();
    await page.getByLabel('API Tester page').waitFor();
    await page.getByLabel('Value for id').fill('42');
    await page.locator('.tester-page-bar').getByText('PATCH {{baseUrl}}/users/:id').waitFor();

    // the host does this when the user clicks another endpoint in the sidebar
    await send(view(b.id));
    await page.locator('.tester-page-bar').getByText('GET {{baseUrl}}/users/search').waitFor();
    expect(await page.locator('.url-input').inputValue()).toBe('{{baseUrl}}/users/search');
    expect(await page.locator('.method-select').inputValue()).toBe('GET');
    expect(await page.getByLabel('Path variable id').count()).toBe(0); // no leftovers from the previous endpoint
    const keys = await page.locator('.params-tab .kv-row input[placeholder="Key"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(keys).toEqual(['term', 'limit']);
    expect(await page.getByLabel('API Tester page').isVisible()).toBe(true); // still on the tester page

    // clicking the same endpoint again keeps what the user typed
    await page.getByRole('textbox', { name: /Key/ }).first().waitFor().catch(() => undefined);
    await page.locator('.params-tab .kv-row input[placeholder^="string"]').first().fill('hello');
    await send(view(b.id));
    expect(await page.locator('.params-tab .kv-row input[placeholder^="string"]').first().inputValue()).toBe('hello');
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);
});

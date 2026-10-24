# Codebase API Flow Explorer

A local, offline VS Code extension that statically analyzes a JavaScript/TypeScript workspace and shows **how frontend
pages and components reach API endpoints, middleware, guards, controllers, services and data stores** — with the source
evidence and a confidence level for every relationship. Nothing is executed, uploaded or sent to an AI service.

Screenshot of an endpoint flow: [docs/endpoint-flow.png](docs/endpoint-flow.png).

## What it understands

* **Frontend**: React components/hooks, `fetch` and axios (including `axios.create({ baseURL })`, API wrapper
  functions, env-based base URLs), Next.js pages, client/server boundaries.
* **Backend**: Express (routers, mounts, middleware), NestJS (controllers, guards, interceptors, DI, modules),
  Next.js App Router route handlers and Pages API routes.
* **Data & infrastructure**: Mongoose, Prisma, TypeORM, Redis, Elasticsearch, Bull/BullMQ queues, event emitters.
* **Matching**: frontend requests are linked to endpoints by method, normalized path and resolvable base URL.
  Dynamic or ambiguous matches are shown as *inferred*; anything without evidence is *unresolved* with the reason.

Details: [supported patterns](docs/supported-patterns.md) · [limitations](docs/limitations.md).

## Install

```bash
npm install
npm run package                 # builds and creates api-flow-explorer.vsix
code --install-extension api-flow-explorer.vsix
```

Requires VS Code ≥ 1.90. Developed on Linux (Xubuntu) with Node 22.

## Use

Open a workspace and trust it, then:

1. **API Flow Explorer: Scan Workspace** (progress notification, cancellable). Results appear in the *API Flow Explorer*
   activity-bar view and the output channel (scan report + diagnostics).
2. **Open API Graph** (or click an endpoint in the sidebar). The sidebar has a search box, All / Frontend / Backend
   pills (Next.js is frontend, everything else backend), collapsible groups (Endpoints, Frontend Requests, Services,
   Models, External APIs) and a Filters section (HTTP method, framework, node types, confidence). The same filters are
   in the graph page's bottom dock and the two stay in sync. The graph shows the selected endpoint's callers upstream
   and its handlers, services and data stores downstream; use the `◂ n` / `n ▸` badges to expand. Clicking a node opens
   its file at the exact line. The *Endpoint Details* panel shows metadata (controller, handler, guards, interceptors,
   module), related nodes, incoming calls, every relationship with its evidence and confidence, and an API Tester tab.
   The *Trace Timeline* is a **static** call path derived from source, not a runtime recording.
3. Edits are picked up automatically (debounced, incremental); *Full Rescan* ignores the cache.

| Command | What it does |
|---------|--------------|
| `API Flow Explorer: Scan Workspace` / `Full Rescan (ignore cache)` | Analyze the workspace |
| `Open API Graph` | Open the graph (optionally focused on an endpoint) |
| `Search API Flows` (`Ctrl+Alt+A`) | Pick an endpoint and open its flow |
| `Find References of Symbol at Cursor` | Callers/renderers/routes/requests that reference the symbol, with evidence |
| `Analyze Impact of Symbol at Cursor` | Endpoints, requests and UI affected by changing the symbol |
| `Export Graph as JSON` / `Export Flow as Mermaid` / `Export Endpoints as Markdown` | Deterministic exports |

| Setting | Default | |
|---------|---------|-|
| `apiFlowExplorer.baseUrls` | `{}` | Values for env vars used in request base URLs, e.g. `{ "NEXT_PUBLIC_API_URL": "http://localhost:3000" }` (`.env` files are never read) |
| `apiFlowExplorer.ignoredDirectories` | `[]` | Extra directory names to skip |
| `apiFlowExplorer.includeTests` | `false` | Analyze `*.test.*`, `__tests__`, … |
| `apiFlowExplorer.maxFiles` | `20000` | Source file limit |
| `apiFlowExplorer.autoRescan` | `true` | Incremental re-analysis on file changes |

## Reading the graph

Edges follow execution flow (request → endpoint → handler → service → data). Solid = resolved from direct evidence,
dashed = inferred (e.g. a dynamic path segment aligned with a route parameter), red dotted = unresolved. "Reachable"
never means "executed". See [graph schema](docs/graph-schema.md).

## Development

```bash
npm install
npm run build            # typecheck + extension/worker bundle (esbuild) + webview (Vite)
npm test                 # Vitest: analyzer, matching, cache, exports, security, real-browser webview tests
npm run test:extension   # real VS Code (Extension Host): scan, navigation, file watcher, export
npm run bench -- 3000    # synthetic benchmark (see docs/benchmarks.md)
```

The browser tests drive the installed Google Chrome/Chromium; they are skipped if none is found. The extension tests use
the locally installed VS Code (`/usr/share/code/code`, or set `VSCODE_EXEC`).

Docs: [architecture](docs/architecture.md) · [graph schema](docs/graph-schema.md) ·
[supported patterns](docs/supported-patterns.md) · [limitations](docs/limitations.md) ·
[security review](docs/security.md) · [benchmarks](docs/benchmarks.md).

## License

MIT

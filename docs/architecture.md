# Architecture

Codebase API Flow Explorer statically analyzes a JavaScript/TypeScript workspace and shows how frontend requests reach
API endpoints, handlers, services and data stores. Everything runs locally; no analyzed code is executed.

```
VS Code extension host                         worker thread (dist/analyzer-worker.js)
┌───────────────────────────────┐              ┌──────────────────────────────────────────────┐
│ commands/  tree  webview host │  workerData  │ scanner → package discovery → framework detect│
│ messaging (Zod validated)     │ ───────────▶ │ cache lookup → ts-morph Project (changed only)│
│ graph queries / impact/export │ ◀─────────── │ per-file extraction (adapters) → FileFacts    │
└──────────────┬────────────────┘   progress   │ linker: cross-file adapters + calls + matcher │
               │ postMessage (Zod)             │ validate → Graph + ScanReport                 │
        ┌──────▼───────┐                       └──────────────────────────────────────────────┘
        │ React Flow   │
        │ webview (CSP)│
        └──────────────┘
```

## Layers

| # | Layer | Code | Notes |
|---|-------|------|-------|
| 1 | Workspace scanner | `src/scanner/workspaceScanner.ts`, `ignoreRules.ts` | Iterative async walk; never reads contents; skips symlinks, ignored dirs, secret files, tests (configurable), >1.5 MB files; cancellable. |
| 2 | Package & framework detection | `packageDiscovery.ts`, `frameworkDetector.ts` | Finds `package.json`/`tsconfig.json`, merges path aliases from every tsconfig, reports unsupported frameworks. |
| 3 | Parser / indexer | `src/analyzer/projectAnalyzer.ts`, `fileContext.ts`, `sourceFileAnalyzer.ts` | One ts-morph `Project`, only for files that need re-analysis. One tree walk per file collects node lists. |
| 4 | Import & symbol resolver | `symbolResolver.ts`, `importResolver.ts`, `staticString.ts` | Declaration naming (`describeDeclaration`), alias/re-export following, module origin of identifiers, static string evaluation. |
| 5 | Framework adapters | `src/analyzer/adapters/*` | `express`, `nestjs`, `nextjs`, `react`, `database`, `shared/httpClient`. All emit the same facts/nodes/edges. |
| 6 | Call-graph builder | `callGraphBuilder.ts` | Statically resolvable calls, `new`, JSX renders. |
| 7 | Endpoint ↔ request matcher | `endpointMatcher.ts`, `pathUtils.ts` | Method + normalized path + resolvable base URL; confidence rules below. |
| 8 | Canonical graph builder & validator | `src/graph/graphBuilder.ts`, `graphValidator.ts`, `src/types/graph.ts` | Zod schemas, unique IDs, no dangling edges. |
| 9 | Query / impact engine | `graphQueries.ts`, `graphTraversal.ts`, `impactAnalyzer.ts` | Endpoint-centric views, expansion, reverse dependencies. |
| 10 | Cache & incremental analysis | `src/cache/*`, `projectAnalyzer.ts` | Versioned JSON of per-file facts with dependency hashes. |
| 11 | VS Code commands & providers | `src/commands/*`, `src/providers/*`, `src/extension.ts` | |
| 12 | Webview | `webview/src/*` | React + `@xyflow/react`; layout (dagre) is separate from analysis. |
| 13 | Exports | `src/export/*` | JSON, Mermaid, Markdown — pure functions. |
| 14 | Tests | `tests/*` | See [Testing](#testing). |

The analyzer (`src/analyzer`, `src/graph`, `src/scanner`, `src/cache`) imports nothing from `vscode` and is tested
without launching VS Code. The webview imports only `src/types` and `src/messaging/messageSchemas.ts`.

## Two-phase adapters

Per-file work is cacheable; cross-file work is not. Each adapter therefore has two entry points
(`src/analyzer/adapters/shared/adapter.ts`):

* `extract(ctx)` — runs per changed file against its syntax tree and writes **facts** (`FileFacts`): symbol
  declarations, calls, request call sites, framework facts (`express`, `nest`), and file-local nodes/edges (Next.js
  endpoints, data-access edges, DI edges). Facts are plain JSON and are what the cache stores.
* `link(ctx)` — runs once over all files' facts. Express mounts routers and applies prefixes; NestJS applies global
  prefixes and module registration. The request/endpoint matcher and the call graph run after all adapters' `link`.

Framework rules never enter the core model: adapters only produce canonical node and edge kinds.

## Symbol identity

Every code symbol has the ID `sym:<workspace-relative path>#<qualified name>` (`sym:server/services/userService.ts#UsersService.findAll`).
`describeDeclaration()` names a declaration the same way whichever file asks, so a call in file A resolves to exactly
the ID file B declared. IDs contain no absolute paths. See [graph-schema.md](graph-schema.md) for all ID formats.

## Incremental analysis

1. Scan files (path, size, mtime). Files whose mtime+size match the cache reuse their stored content hash; others are
   read and hashed (SHA-1).
2. A **context hash** (analyzer build hash, options, content of `package.json`/`tsconfig.json`/… files) must match the
   cache, otherwise everything is reanalyzed.
3. A cached file is valid if its own hash matches **and** every dependency hash recorded when it was analyzed still
   matches. Dependencies are every workspace file whose declarations or constants influenced the file's facts (direct
   imports, re-export hops, constants read through `evalString`). Deleted dependencies hash as `MISSING`, so
   dependents are invalidated.
4. A file that had unresolved imports is reanalyzed whenever files are added.
5. Only invalid files are given to ts-morph; their imports are pulled in lazily by module resolution.
6. Linking always runs over all facts (no parsing; ~0.2–0.3 s at 8,000 files).

Property: the incremental result equals a from-scratch analysis (asserted in `tests/unit/cache.test.ts`).
The analyzer version in the cache key is a content hash of `src/` injected at build time, so code changes can never
reuse stale facts. Corrupt, truncated or incompatible caches are discarded and rebuilt.

## Frontend ↔ backend matching

`endpointMatcher.ts` links a request node to endpoints using only evidence:

1. Resolve the URL (`staticString.ts` → parts with holes → `resolveUrl`): literals, `const`s (also imported),
   enum members, `process.env.X` / `import.meta.env.X` (values only from `apiFlowExplorer.baseUrls`), `axios.create({ baseURL })`.
2. API wrapper propagation: if a function's request URL/method comes from a parameter and callers pass static strings
   for it, each call site becomes its own request (depth ≤ 3). A parameter nobody supplies statically is just a dynamic
   path segment.
3. Match method and segments. A request hole matches route **params** only, never route literals; the most specific
   literal route wins; equally specific routes are all linked as ambiguous (low, inferred).
4. Classify (`high/medium/low`, `resolved/inferred/unresolved`): dynamic segments → medium inferred; unknown base,
   unknown method, partially dynamic segment, ambiguity → low inferred; unmatched/dynamic → `unknown` node with an
   unresolved edge carrying the reason.

## Webview and messaging

The host owns the graph; the webview asks for views by node ID (`focus`, `expand`) and receives `subgraph` messages
(≤ 300 nodes for a focus view). Both directions are validated with Zod (`src/messaging/messageSchemas.ts`). The webview
never sends file paths: `openNode`/`openEvidence` carry IDs and the host resolves and bounds-checks the location.

## Testing

| Layer | Where | What |
|-------|-------|------|
| Unit / analyzer | `tests/unit/*.test.ts` | Fixture graphs asserted node-by-node and edge-by-edge, with negative tests. |
| Webview in a real browser | `tests/integration/webviewBrowser.test.ts` | Chrome + the exact production HTML/CSP, mocked `acquireVsCodeApi`, real analyzer data. |
| Extension host | `tests/extension/*` | Real VS Code: activation, scan in worker, click-to-source, file-watcher incremental update, export. |
| Benchmarks | `scripts/bench.mjs` | Synthetic project; see [benchmarks.md](benchmarks.md). |

# Security and privacy review

## Model

The extension reads source files of a workspace the user opened and trusted. The workspace content is **untrusted
input** (a cloned repository can be hostile). The extension must never execute it, leak it, or be hijacked by it.

## Controls

| Area | Control | Where / test |
|------|---------|--------------|
| Offline | No network code, telemetry, AI API or hosted service. Audited: no `http(s)`, `net`, `fetch`, `XMLHttpRequest`, `WebSocket`, `child_process`, `eval`, `new Function` in `src/` or `webview/src/`. | `grep` audit in this review; the VSIX contains no such code besides bundled TypeScript |
| No code execution | Source is only parsed with the TypeScript compiler. No `require`/`import` of workspace files, no config evaluation (`next.config.js` is never run), no tsconfig plugins loaded, `types: []`. | `projectAnalyzer.createProject` |
| Workspace Trust | `capabilities.untrustedWorkspaces: limited`; scanning is refused in untrusted workspaces. | `scanWorkspace.runScan` |
| Secret files | `.env*`, `*.pem`, `*.key`, `*.crt`, `*.p12`, `id_rsa`, `.npmrc`, `credentials*`, `secrets*` are never read, hashed or indexed; reported only as "secret file excluded". | `ignoreRules.isSecretFile`, `tests/unit/edgeCases.test.ts` |
| Secret values in code | Every string in extracted facts (call text, URLs, evidence) is redacted before it reaches the graph, cache or exports: URL credentials, `?api_key=`-style parameters, `sk_live_…`, AWS keys, JWTs, GitHub/Slack tokens, `Bearer`/`Basic`. | `analyzer/redact.ts`, `tests/unit/security.test.ts`, `tests/unit/cache.test.ts` |
| Exports | JSON/Markdown/Mermaid contain only graph data (IDs, relative paths, line numbers, explanations); no source text. Mermaid labels are escaped. | `tests/unit/exportsAndImpact.test.ts` |
| Webview CSP | `default-src 'none'; style-src <webview>; script-src 'nonce-…'; img-src <webview> data:; font-src <webview>`. No `unsafe-inline`/`unsafe-eval`. Verified in real Chrome with the production HTML: zero violations. | `providers/htmlTemplate.ts`, `tests/integration/webviewBrowser.test.ts` |
| Webview resources | Two webviews (graph page, sidebar list), each with `localResourceRoots` limited to its own bundle folder (`dist/webview`, `dist/webview-sidebar`); the analyzed workspace is unreachable from the webview. | `providers/graphViewProvider.ts` |
| Messages | Zod-validated in both directions. The webview sends node/edge **IDs**, never paths; the host resolves them from the graph and checks the result stays inside the workspace root. Bounds on array sizes, depths. | `messaging/*`, `graph/sourceLocation.ts`, `tests/extension/suite/navigation.test.ts` |
| No unsafe rendering | React only; no `dangerouslySetInnerHTML`/`innerHTML`. Hostile host messages render nothing (tested with an `<img onerror>` payload). | browser test |
| Symlinks | The scanner skips symlinks; files resolved outside the workspace root (via `node_modules` links) are ignored. | `tests/unit/security.test.ts` |
| Resource limits | `maxFiles` (default 20,000), 1.5 MB per file, bracket-depth guard, worker heap cap 4 GB, cancellable (worker terminated), analysis off the extension host thread. | `workspaceScanner.ts`, `runInWorker.ts` |
| Cache | Written under VS Code's per-workspace storage; atomic rename; corrupt/incompatible cache is discarded; contains facts only (no file contents). | `cache/cacheManager.ts`, `tests/unit/cache.test.ts` |
| Dependencies | All runtime code is bundled from devDependencies (TypeScript/ts-morph, zod, React, `@xyflow/react`, dagre). `npm audit`: 0 vulnerabilities at release. | |

## Findings fixed during the review (each has a regression test)

1. **Secrets in the cache.** Request facts stored the raw source of the call, so `fetch('https://u:p@host/?api_key=…')`
   would have been persisted. Fixed by redacting every string in the facts (`redactDeep`) plus targeted redaction of
   evaluated URLs.
2. **ReDoS in the redactor.** An unbounded `[\w-]*…[\w-]*` pattern was quadratic: a 30 KB string took 354 ms, so a
   hostile 1 MB literal could hang the analyzer. Quantifiers are now bounded; a test feeds 1 MB adversarial strings.
3. **Parser stack overflow.** About 500+ nested parentheses overflow the TypeScript parser's stack (measured: the main
   thread fails above ~500, a worker above ~3,000), and the exception escaped the per-file handler, aborting the scan.
   Fixed with a bracket-depth guard and a file system wrapper that serves blocked files as empty even when an importer
   resolves them (`guardedFileSystem.ts`); the file is reported as skipped.
4. **Zod JIT vs strict CSP.** Zod 4 probes `new Function` when schemas are constructed, producing a CSP `eval`
   violation. The webview sets `jitless` before any schema module loads (`webview/src/zodConfig.ts`).
5. **Stale analysis after upgrades.** A persisted cache from an older analyzer was reused after the logic changed. The
   cache key now includes a content hash of `src/` injected at build time.
6. **Wrong source location** for models declared in another file (pointed at the first usage). Fixed; asserted in tests.

## Residual risks and notes

* A malicious repository can still make analysis slow (many large-but-valid files). Limits and cancellation bound it.
* Output channel diagnostics quote short snippets of workspace source; they pass through redaction.
* `apiFlowExplorer.baseUrls` is a workspace setting a repository could pre-populate; it only influences how request
  URLs are matched and is never fetched.
* The extension is not signed or published; the `.vsix` is a local build.

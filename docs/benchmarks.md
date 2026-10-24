# Benchmarks

Reproduce: `npm run build && npm run bench -- 3000` (writes a synthetic project to `.test-tmp/`, runs the production
worker bundle `dist/analyzer-worker.js`, prints JSON including a per-phase time breakdown — the same breakdown appears
in the "API Flow Explorer" output channel after every scan).

The generator creates, per feature slice, a Mongoose model, service, controller, Express router, axios client, hook,
component and page (8 files), plus one `app.ts` mounting every router. At 8,001 files the graph has 25,001 nodes,
25,000 edges and 4,000 endpoints.

Environment: Linux, 12 logical CPUs, Node v22.22.1, worker with an 8 GB old-space limit. "Peak RSS" is the whole
process sampled every 50 ms. Phases: **scan** = directory walk + config discovery, **hash** = reading/hashing files that
are not in the cache, **parse** = ts-morph + extraction of changed files, **link** = merging facts into the graph and
matching requests to endpoints.

| Files | Run | Total | Peak RSS | Analyzed | From cache | scan | hash | parse | link | cache load/save |
|------:|-----|-----:|---------:|---------:|-----------:|-----:|-----:|------:|-----:|----------------:|
| 1,001 | cold | 2.1 s | 301 MB | 1,001 | 0 | 49 ms | 84 ms | 1.6 s | 29 ms | 3/14 ms |
| 1,001 | warm (nothing changed) | 398 ms | 201 MB | 0 | 1,001 | 48 ms | 1 ms | 0 ms | 37 ms | 10/6 ms |
| 1,001 | edit a leaf component | 740 ms | 243 MB | 2 | 999 | 48 ms | 2 ms | 298 ms | 60 ms | 11/19 ms |
| 1,001 | rename a service function | 580 ms | 258 MB | 2 | 999 | 53 ms | 2 ms | 64 ms | 27 ms | 12/11 ms |
| 1,001 | forced full rescan | 1.9 s | 325 MB | 1,001 | 0 | 51 ms | 82 ms | 1.5 s | 27 ms | 1/14 ms |
| 3,001 | cold | 4.3 s | 383 MB | 3,001 | 0 | 156 ms | 271 ms | 3.3 s | 80 ms | 2/75 ms |
| 3,001 | warm (nothing changed) | 618 ms | 245 MB | 0 | 3,001 | 104 ms | 34 ms | 1 ms | 91 ms | 27/34 ms |
| 3,001 | edit a leaf component | 830 ms | 278 MB | 2 | 2,999 | 108 ms | 12 ms | 256 ms | 76 ms | 27/26 ms |
| 3,001 | rename a service function | 746 ms | 262 MB | 2 | 2,999 | 107 ms | 15 ms | 78 ms | 100 ms | 26/35 ms |
| 3,001 | forced full rescan | 4.2 s | 413 MB | 3,001 | 0 | 105 ms | 243 ms | 3.3 s | 77 ms | 2/90 ms |
| 8,001 | cold | 9.7 s | 609 MB | 8,001 | 0 | 254 ms | 665 ms | 7.7 s | 220 ms | 1/307 ms |
| 8,001 | warm (nothing changed) | 1.1 s | 339 MB | 0 | 8,001 | 232 ms | 16 ms | 1 ms | 267 ms | 86/83 ms |
| 8,001 | edit a leaf component | 1.5 s | 405 MB | 2 | 7,999 | 244 ms | 20 ms | 267 ms | 311 ms | 86/93 ms |
| 8,001 | rename a service function | 1.1 s | 389 MB | 2 | 7,999 | 238 ms | 15 ms | 59 ms | 209 ms | 84/67 ms |
| 8,001 | forced full rescan | 9.4 s | 709 MB | 8,001 | 0 | 243 ms | 592 ms | 7.6 s | 213 ms | 1/330 ms |

Run-to-run variation on this machine is roughly ±30%, so read these as orders of magnitude, not exact figures
(the first 1,001-file table of an earlier session measured a 3.5 s cold scan for the same project).

## Observations

* **Cold cost is parsing**, ~1 ms/file here, and scales roughly linearly. The analysis runs in a worker thread, so the
  extension host stays responsive; cancelling terminates the worker.
* **Incremental updates are cheap**: an edit re-analyzes the file and the files that resolved symbols through it
  (2 of 8,001), about 60–270 ms of parsing. The remaining 1–1.5 s at 8k files is the fixed cost of re-walking the
  tree (~0.25 s), loading/saving the JSON cache (~0.17 s) and re-linking all facts (~0.2–0.3 s).
* **Finding fixed by measurement**: the first version of the request matcher compared every request with every
  endpoint, and linking took 1.3–1.4 s at 8k files (more than half of an incremental update). Indexing endpoints in a
  segment trie cut linking to ~0.2 s. A randomized differential test (`tests/unit/matching.test.ts`) checks the index
  returns exactly the endpoints a full scan would.
* The cache is a single JSON file; at these sizes it costs ≤ 0.35 s per write, so SQLite was **not** introduced.
  Revisit if projects of 30k+ files matter.
* Memory grows ~45 MB per 1,000 files during a cold scan (ts-morph program + facts); the worker is capped at 4 GB in
  the extension.
* UI: a 300-node synthetic graph (the largest view the extension will send) renders in the real-browser test in
  ~0.4 s including layout (`[perf]` line in `tests/integration/webviewBrowser.test.ts` output).
* These are synthetic small files without installed `node_modules` typings; real repositories with large files and
  installed type packages parse more slowly. Treat the numbers as relative.

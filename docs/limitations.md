# Limitations

This is a **static** analyzer. It reports what the source provably contains and marks everything else as inferred or
unresolved. These are the known gaps; none of them is silently turned into a relationship.

## Fundamental

* A `calls` edge means a resolvable call exists in the source. It does not mean the call executes, in what order, how
  often, or under which branch. Impact analysis is a static over-approximation.
* No runtime data. Request/response payloads and schemas are not extracted; only call sites, URLs, methods and
  source locations.
* Anything that needs running code is out of scope: values from `.env` files (never read; supply base URLs through
  `apiFlowExplorer.baseUrls`), computed routes, plugins that register routes at startup.

## Resolution

* Calls are resolved through TypeScript's checker. Calls through interfaces/abstract classes are not mapped to
  implementations; higher-order flows (`items.map(handler)`) create no call edge; dynamic property access creates none.
* Functions that **return** routers (`createRouter()`) are not followed; routers must be variables, imports or default
  exports. Express 5 path syntax and case-insensitive/strict routing are not modelled (paths are matched case-sensitively).
* URL builders that are functions (`routes.user(id)`) are not evaluated; such requests are reported as dynamic.
* Wrapper propagation stops after 3 levels and only follows direct calls with statically evaluable arguments.
* Path aliases: when several tsconfig files define the same alias differently, targets are tried in order and a
  `config` diagnostic is emitted; resolution may pick the wrong package.
* New files can change how an existing import resolves (e.g. `./x.ts` vs `./x/index.ts`); only files that previously
  had *unresolved* imports are reanalyzed when files are added.
* Plain JavaScript relies on TypeScript's JS inference; unusual CommonJS patterns (`exports.x = …` aggregation) may not resolve.

## Frameworks

* Express: regex paths, routers created by factories, `router.param`, `app.engine`, sub-apps' `mountpath`.
* NestJS: global guards/interceptors (`APP_GUARD`, `useGlobalGuards`), `configure(consumer)` middleware,
  `RouterModule` prefixes, URI versioning, dynamic modules (`forRoot`), custom providers (`useFactory`, string tokens),
  microservice message patterns, GraphQL resolvers.
* Next.js: `middleware.ts`, `basePath`/`rewrites`/`redirects`/`i18n`, Server Actions, `generateStaticParams`.
* React: react-router route tables, React Query/SWR/ky/superagent/XHR/WebSocket/GraphQL clients (only `fetch` and axios).
* Fastify, Koa, hapi, Restify, tRPC, Apollo, Vue, Svelte, Angular, Remix, Nuxt and Kafka/RabbitMQ are detected from
  `package.json` and reported with an `unsupported-framework` diagnostic; they are not analyzed.
* Data stores: Knex, Sequelize, Drizzle, the native MongoDB driver and SQL string queries are not recognized. A model
  passed through a function parameter, or created with `connection.model()`, is not followed.

## Graph and UI

* Two ORMs defining the same model name share one `model:<name>` node.
* Router/app-level Express middleware order is approximated from source position; cross-file order is unknown (medium).
* A focus view is capped at 300 nodes (a banner says when truncated); use the expand buttons for more. The webview
  virtualizes off-screen nodes.
* `imports`, `returns`, and the `repository` node kind exist in the schema but the MVP does not emit them.
* Files over 1.5 MB, or with bracket nesting deeper than 250, are skipped with a diagnostic (parser stack safety).

## Scale

* The cache is one JSON file rewritten after each change (≤ 0.35 s at ~8,000 files);
  SQLite was deliberately not introduced because measurements did not call for it ([benchmarks.md](benchmarks.md)).
* Benchmarks use a synthetic project of small files. Real repositories with large files and installed typings parse
  more slowly.

## Environment

* Developed and tested on Linux (Xubuntu) with VS Code 1.108 and Node 22. Other platforms use the same code paths but
  are untested.
* Multi-root workspaces analyze one folder at a time (a picker appears when there is more than one).
* The workspace is analyzed only when it is trusted.

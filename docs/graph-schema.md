# Graph schema

The canonical graph is validated with Zod (`src/types/graph.ts`, `src/graph/graphValidator.ts`):
duplicate node/edge IDs, dangling edge endpoints, absolute or `..` paths, unknown kinds and invalid line numbers are
rejected. Nodes and edges are sorted by ID so exports are byte-stable.

```ts
Graph  = { schemaVersion: 1, nodes: GraphNode[], edges: GraphEdge[] }
GraphNode = { id, kind, name, qualifiedName?, path?, startLine?, endLine?, startColumn?, metadata }
GraphEdge = { id, source, target, kind, evidence: { path, line, explanation },
              confidence: 'high'|'medium'|'low', resolution: 'resolved'|'inferred'|'unresolved', reason? }
```

**Edge direction follows execution flow**: request → endpoint → handler → service → data store. `subscribes`
points from the queue/event to its consumer. `path` is always workspace-relative POSIX.

## Confidence and resolution

| Resolution | Meaning |
|------------|---------|
| `resolved` | Direct source evidence (an import-resolved call, a literal URL matching a literal route, an explicit decorator). |
| `inferred` | Derived from partial evidence: a dynamic path segment aligned with a route param, methods deduced from `req.method` checks, middleware order approximated from source position, an env default value. |
| `unresolved` | A relationship the source clearly implies but for which no target can be established. The edge points at an `unknown` node and `reason` says why. |

`confidence` (`high` > `medium` > `low`) expresses how much to trust the edge; `reason` always explains a downgrade.
Static analysis never proves execution: a call edge means the source *contains* a resolvable call.

## Node kinds

| Kind | Produced for | Key metadata |
|------|--------------|--------------|
| `frontend-page` | Next.js `page.tsx` / `pages/*` default export | `route`, `router` (`app`/`pages`), `framework` |
| `frontend-component` | Capitalized function/class/arrow containing JSX | `framework: react` |
| `api-client` | A `fetch`/axios call site | `method`, `library`, `rawUrl`, `normalizedPath`, `execution` (`client`/`server`/`unknown`), `viaWrapper`, `origin` |
| `api-endpoint` | Express route, Nest handler, Next route handler/API route | `method`, `path`, `framework`, `router`/`controller`, `dynamic`, `prefixUnknown`, `methodInferred` |
| `route` | Express app / Router | `routerKind`, `framework` |
| `middleware` | Function used as Express middleware; Nest `NestMiddleware` | |
| `guard` / `interceptor` | Nest classes implementing `CanActivate` / `NestInterceptor`; `external: true` nodes for library guards | |
| `controller` | `@Controller` classes and their methods | `prefix`, `class`, `registeredIn` |
| `service` | `@Injectable` classes and their methods | `registeredIn` |
| `function` | Any other referenced function/method/class | `symbolType`, `exported`, `hook`, `anonymous`, `executes` |
| `repository` | Reserved (not emitted in the MVP) | |
| `model` | Mongoose / TypeORM / Prisma model | `orm` |
| `database` | Redis, Elasticsearch, raw Prisma | `engine` |
| `queue` | Bull/BullMQ queues, Nest events | `transport` |
| `external-api` | Absolute request URL to a non-local, non-configured host | `origin` |
| `unknown` | Unresolvable target (request, handler, mount) | `reason` |

Only referenced symbols are materialized: a plain function with no edges is not a node; classified classes and
components always are.

## Edge kinds

| Kind | Source → target |
|------|-----------------|
| `calls` | symbol → symbol; owner → request node |
| `renders` | component → component |
| `http-request` | request → endpoint / `external-api` / `unknown` |
| `handles-route` | endpoint → handler |
| `mounts-router` | router → router |
| `uses-middleware` | endpoint → middleware (also Nest interceptors, target kind `interceptor`) |
| `uses-guard` | endpoint → guard |
| `injects` | class → class/model/queue it receives through DI |
| `reads` / `writes` | symbol → model/database |
| `publishes` | symbol → queue/event |
| `subscribes` | queue/event → consumer |
| `imports`, `returns` | Reserved; not emitted in the MVP (imports are used for resolution and cache dependencies only). |

## ID formats

| Entity | ID |
|--------|----|
| Code symbol | `sym:<path>#<qualified>` (anonymous handlers: `sym:<path>#GET /x@L12`; module scope: `#<module>`) |
| Router/app | `route:<path>#<variable>` |
| Endpoint | `endpoint:<METHOD> <full path>@<path>:<line>` |
| Request | `request:<path>:<line>:<column>`; wrapper expansion: `…@<caller path>:<line>` |
| Model / database / queue / external | `model:<name>`, `database:<engine>`, `queue:<name>` (`queue:event:<name>`), `external:<host>` |
| Unknown | `unknown:<description>` |
| Edge | `<kind>|<source>|<target>` (one edge per kind and endpoints; strongest confidence and earliest evidence win) |

Known collision: two ORMs defining the same model name share one `model:<name>` node.

## Separation of concerns

Declarations (`FileFacts.symbols`), resolved calls (`calls` edges), inferred relationships (`resolution: inferred`),
and runtime observations are distinct. The MVP has no runtime-observed data; the schema has no field for it, so it
cannot be confused with static results.

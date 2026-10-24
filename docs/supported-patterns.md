# Supported patterns

Everything listed here has a fixture and test. Anything not listed is either unsupported (see
[limitations.md](limitations.md)) or produces an explicit diagnostic.

## Express (`src/analyzer/adapters/express`)

| Pattern | Notes |
|---------|-------|
| `app.get/post/put/patch/delete/head/options/all(path, ...handlers)` | The receiver must be traceable to `express()` or `express.Router()`/`Router()` (ES import, `require`, default/`module.exports` export, re-export). A parameter typed `Application`/`Express`/`Router` from `express` also counts. |
| `router.route('/p').get(h).post(h)` | Chained verbs. |
| Array paths `['/a', '/b']`, template literals, `const` prefixes (also imported, e.g. across packages) | Holes become `:param` and mark the endpoint `dynamic`. |
| `app.use('/prefix', router)`, `app.use(router)`, `app.use(path, mw, router)` | Prefix normalization; routers imported ES-style, via `require('./x')`, or from namespaces. |
| Handlers: identifiers, `ns.fn`, object-literal methods, inline functions, `asyncHandler(fn)`-style wrappers, factory calls (`requireRole('x')`, medium confidence) | Inline handlers become their own symbols so calls inside them are attributed to the endpoint. |
| Middleware | Route-level and mount-level → `high/resolved`. Router/app-level `use(mw)` registered earlier → `medium/inferred` (order and path filters are approximated). |

Diagnostics instead of guesses: regex paths (`dynamic-route`), unresolvable mounted routers (`unresolved-mount`),
unresolvable handlers (`unresolved-handler`), routers never mounted (endpoint marked `prefixUnknown`, medium).
`app.get('setting')` (one string argument) is not a route.

## NestJS (`adapters/nestjs`)

`@Controller('x' | { path } )`, `@Get/@Post/@Put/@Patch/@Delete/@All/@Options/@Head` (string, array or no path),
`app.setGlobalPrefix()` (per package; otherwise a unique project-wide prefix, medium), `@UseGuards`/`@UseInterceptors`
at class and method level (workspace classes → `high`; library guards such as `AuthGuard('jwt')` → external node,
`medium`), `@Injectable` services, classes implementing `CanActivate`/`NestInterceptor`/`NestMiddleware`, constructor and
`@Inject()` property DI (including `forwardRef`), `@Module({ controllers, providers })` recorded as `registeredIn`
metadata, `@InjectModel`, `@InjectRepository`, `@InjectQueue`, `@InjectRedis`, `@Processor`/`@Process`, `@OnEvent`.
Controller → service → model chains come from ordinary resolved calls.

## Next.js (`adapters/nextjs`)

* App Router `route.ts`: exported `GET/POST/…` functions/consts, `export { handler as PUT }`, route groups `(g)`,
  parallel slots `@x`, `[id]`, `[...slug]`, `[[...slug]]`.
* Pages Router `pages/api/**`: default export (function, wrapped `withX(handler)`); methods are inferred from
  `req.method` comparisons/`switch` (`methodInferred`, medium) — none found means `ALL`.
* Pages/components: `page.tsx` and `pages/**` default exports become `frontend-page` with their route.
* Client/server: `'use client'`/`'use server'`, app-dir files without `'use client'` (server), `getServerSideProps` /
  `getStaticProps` (server), route handlers (server), React files (client). Shown as `execution` on request nodes.

## React and HTTP clients (`adapters/react`, `adapters/shared/httpClient`)

* Components (capitalized + JSX), hooks (`useX`), `renders` edges from JSX tags, component → hook → API function calls.
* `fetch(url, { method })` (also `window.fetch`, `node-fetch`/`cross-fetch`), `axios.get/post/…`, `axios(config)`,
  `axios.request`, `axios.create({ baseURL })` instances (also imported from another file) with env-based base URLs.
* Static URLs, template literals, `const`/enum/object-property constants, `process.env.X` / `import.meta.env.X`
  (configure `apiFlowExplorer.baseUrls`), `process.env.X ?? 'default'` (medium).
* API wrapper functions: static arguments at call sites are propagated into the wrapper's request (depth ≤ 3).

## Data access (`adapters/database`)

Evidence-based only (initializer, decorator or declared type — never names):

| Library | Recognized |
|---------|------------|
| Mongoose | `mongoose.model('X', …)` (incl. `mongoose.models.X \|\| mongoose.model(…)`), `@InjectModel`, `Model<T>` typed members, `new Model().save()`, `@Schema` classes |
| TypeORM | `@InjectRepository(E)`, `Repository<E>`, `getRepository(E)`, `dataSource.getRepository(E)`, `extends BaseEntity`, `createQueryBuilder` (read, medium) |
| Prisma | `new PrismaClient()`, typed `PrismaClient`, classes extending `PrismaClient`; `client.model.op()` and `$queryRaw`/`$executeRaw` |
| Redis | `new Redis()` (ioredis), `redis.createClient()`, `@InjectRedis()`, typed clients |
| Elasticsearch/OpenSearch | `new Client()`, typed clients; the `index` name is reported in evidence |
| Queues & events | Bull/BullMQ `new Queue` + `add`/`process`, `new Worker`, `@InjectQueue`, `@Processor`/`@Process`, `EventEmitter`/`EventEmitter2` `emit`/`on`, `@OnEvent` |

Only listed operations create `reads`/`writes` edges; unknown operations create nothing.

## Resolution machinery

Path aliases from any `tsconfig.json`/`jsconfig.json` (merged, `extends` followed); monorepo workspace packages;
re-exports and `export default x`; `module.exports = x`; `require()` of relative modules; namespace imports.
Unresolved relative imports and aliases, non-literal dynamic `import()`, and literal dynamic imports are reported as
diagnostics (`unresolved-import`, `unresolved-alias`, `dynamic-import`).

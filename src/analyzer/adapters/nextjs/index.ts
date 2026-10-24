import { Node, type SourceFile } from 'ts-morph';
import type { GraphEdge, GraphNode } from '../../../types/graph';
import { endpointId } from '../../../graph/ids';
import { packageOf } from '../../../scanner/packageDiscovery';
import type { FileContext } from '../../fileContext';
import type { FrameworkAdapter } from '../shared/adapter';
import { handlerRef } from '../shared/handlers';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const APP_ROUTE = /^(?:(.*)\/)?(?:src\/)?app\/(?:(.*)\/)?route\.(?:ts|js|tsx|jsx|mjs)$/;
const APP_PAGE = /^(?:(.*)\/)?(?:src\/)?app\/(?:(.*)\/)?page\.(?:tsx|jsx|ts|js)$/;
const APP_ANY = /(^|\/)(?:src\/)?app\//;
const PAGES_API = /^(?:(.*)\/)?(?:src\/)?pages\/api\/(.+)\.(?:ts|js|tsx|jsx|mjs)$/;
const PAGES_PAGE = /^(?:(.*)\/)?(?:src\/)?pages\/(.+)\.(?:tsx|jsx|ts|js)$/;
const SERVER_FUNCTIONS = new Set(['getServerSideProps', 'getStaticProps', 'getStaticPaths', 'getInitialProps']);

/** `users/[id]/(group)/@slot` → `/users/:id`; catch-all segments become wildcards. */
export function nextSegmentsToPath(raw: string | undefined): string {
  if (!raw) return '/';
  const out: string[] = [];
  for (const seg of raw.split('/').filter(Boolean)) {
    if (/^\(.*\)$/.test(seg) && !/^\(\.+\)/.test(seg)) continue; // route group
    if (seg.startsWith('@')) continue; // parallel route slot
    if (/^\(\.+\)/.test(seg)) continue; // intercepting route marker
    const optionalCatchAll = /^\[\[\.\.\.(\w+)\]\]$/.exec(seg);
    const catchAll = /^\[\.\.\.(\w+)\]$/.exec(seg);
    const dynamic = /^\[(\w+)\]$/.exec(seg);
    if (optionalCatchAll) out.push('*');
    else if (catchAll) out.push('*' + catchAll[1]);
    else if (dynamic) out.push(':' + dynamic[1]);
    else out.push(seg);
  }
  return '/' + out.join('/');
}

function hasNext(ctx: FileContext): boolean {
  const pkg = packageOf(ctx.project.meta, ctx.path);
  if (pkg) return pkg.dependencies.has('next');
  return ctx.project.meta.packages.some((p) => p.dependencies.has('next'));
}

/** Method names compared against `req.method` inside a Pages Router API handler. */
function methodsInHandler(fn: Node | undefined): string[] {
  if (!fn) return [];
  const found = new Set<string>();
  const isReqMethod = (n: Node) => Node.isPropertyAccessExpression(n) && n.getName() === 'method';
  fn.forEachDescendant((n) => {
    if (Node.isBinaryExpression(n)) {
      const op = n.getOperatorToken().getText();
      if (op === '===' || op === '==' || op === '!==' || op === '!=') {
        const [l, r] = [n.getLeft(), n.getRight()];
        const lit = isReqMethod(l) ? r : isReqMethod(r) ? l : undefined;
        if (lit && Node.isStringLiteral(lit) && METHODS.includes(lit.getLiteralText().toUpperCase())) found.add(lit.getLiteralText().toUpperCase());
      }
    } else if (Node.isSwitchStatement(n) && isReqMethod(n.getExpression())) {
      for (const c of n.getClauses()) {
        if (Node.isCaseClause(c)) {
          const e = c.getExpression();
          if (Node.isStringLiteral(e) && METHODS.includes(e.getLiteralText().toUpperCase())) found.add(e.getLiteralText().toUpperCase());
        }
      }
    }
  });
  return [...found].sort();
}

function exported(sf: SourceFile, name: string): Node | undefined {
  try {
    return sf.getExportedDeclarations().get(name)?.[0];
  } catch {
    return undefined;
  }
}

function extract(ctx: FileContext): void {
  const p = ctx.path;
  if (!/(^|\/)(app|pages)\//.test(p) || !hasNext(ctx)) return;
  const sf = ctx.sf;
  const addNode = (n: GraphNode) => ctx.facts.nodes.push(n);
  const addEdge = (e: GraphEdge) => ctx.facts.edges.push(e);

  // --- server-only functions and client/server boundary ----------------------------------------
  for (const sym of ctx.facts.symbols) if (SERVER_FUNCTIONS.has(sym.name)) ctx.classify(sym.id, 'function', { executes: 'server', nextDataFunction: true });
  const inApp = APP_ANY.test(p);
  if (ctx.facts.boundary === 'unknown' && (APP_ROUTE.test(p) || PAGES_API.test(p) || (inApp && /(page|layout|template)\.(tsx|jsx|ts|js)$/.test(p)))) ctx.facts.boundary = 'server';

  const makeEndpoint = (method: string, path: string, line: number, handlerId: string | undefined, router: 'app' | 'pages', inferred: boolean, explanation: string) => {
    const eid = endpointId(method, path, p, line);
    addNode({
      id: eid,
      kind: 'api-endpoint',
      name: `${method} ${path}`,
      path: p,
      startLine: line,
      metadata: { method, path, framework: 'nextjs', router, ...(inferred ? { methodInferred: true } : {}) },
    });
    if (handlerId) {
      addEdge({
        id: `handles-route|${eid}|${handlerId}`,
        source: eid,
        target: handlerId,
        kind: 'handles-route',
        evidence: { path: p, line, explanation },
        confidence: inferred ? 'medium' : 'high',
        resolution: inferred ? 'inferred' : 'resolved',
        reason: inferred ? 'HTTP methods inferred from comparisons with req.method' : undefined,
      });
    }
  };

  // --- App Router route handlers ------------------------------------------------------------------
  const appRoute = APP_ROUTE.exec(p);
  if (appRoute) {
    const path = nextSegmentsToPath(appRoute[2]);
    let found = 0;
    for (const method of METHODS) {
      const decl = exported(sf, method);
      if (!decl) continue;
      const sid = ctx.symbolIdOf(decl);
      makeEndpoint(method, path, decl.getStartLineNumber(), sid?.id, 'app', false, `App Router route handler ${method} in ${p}`);
      if (sid) ctx.classify(sid.id, 'function', { nextRouteHandler: true, executes: 'server' });
      found++;
    }
    if (found === 0) ctx.info('unsupported-syntax', 'route file exports no recognizable HTTP method handlers (GET, POST, ...)');
    return;
  }

  // --- Pages Router API routes ----------------------------------------------------------------------
  const pagesApi = PAGES_API.exec(p);
  if (pagesApi) {
    const path = '/api' + (nextSegmentsToPath(pagesApi[2]) === '/index' ? '' : nextSegmentsToPath(pagesApi[2]).replace(/\/index$/, ''));
    const decl = exported(sf, 'default');
    if (!decl) {
      ctx.info('unsupported-syntax', 'API route has no default export');
      return;
    }
    let handlerId: string | undefined;
    let body: Node | undefined = decl;
    if (Node.isFunctionDeclaration(decl) || Node.isVariableDeclaration(decl) || Node.isClassDeclaration(decl)) handlerId = ctx.symbolIdOf(decl)?.id;
    else {
      const ref = handlerRef(ctx, decl, 'default');
      handlerId = ref.id;
      if (Node.isCallExpression(decl)) {
        // export default withAuth(handler): inspect the wrapped function for method checks
        const inner = decl.getArguments().find((a) => Node.isArrowFunction(a) || Node.isFunctionExpression(a) || Node.isIdentifier(a));
        body = inner;
        if (inner && Node.isIdentifier(inner)) body = ctx.resolve(inner)[0];
      }
    }
    if (body && Node.isVariableDeclaration(body)) body = body.getInitializer();
    if (handlerId) ctx.classify(handlerId, 'function', { nextApiHandler: true, executes: 'server' });
    const methods = methodsInHandler(body);
    const line = decl.getStartLineNumber();
    if (methods.length) for (const m of methods) makeEndpoint(m, path, line, handlerId, 'pages', true, `Pages API handler checks req.method === '${m}'`);
    else makeEndpoint('ALL', path, line, handlerId, 'pages', false, 'Pages API handler accepts every HTTP method');
    return;
  }

  // --- pages ---------------------------------------------------------------------------------------
  const appPage = APP_PAGE.exec(p);
  const pagesPage = !appPage && !inApp ? PAGES_PAGE.exec(p) : null;
  if (appPage || (pagesPage && !/^_(app|document|error)$/.test(pagesPage[2].split('/').pop()!) && !pagesPage[2].startsWith('api/'))) {
    const route = appPage ? nextSegmentsToPath(appPage[2]) : nextSegmentsToPath(pagesPage![2].replace(/(^|\/)index$/, ''));
    const decl = exported(sf, 'default');
    const sid = decl ? ctx.symbolIdOf(decl) : undefined;
    if (sid) {
      ctx.classify(sid.id, 'frontend-page', { framework: 'nextjs', route, router: appPage ? 'app' : 'pages' });
    } else if (decl) {
      const ref = handlerRef(ctx, decl, 'default page');
      if (ref.id) ctx.classify(ref.id, 'frontend-page', { framework: 'nextjs', route, router: appPage ? 'app' : 'pages' });
    }
  }
}

export const nextAdapter: FrameworkAdapter = { name: 'nextjs', extract };

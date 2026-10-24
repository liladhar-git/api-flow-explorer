import { Node, SyntaxKind, ts, type CallExpression, type SourceFile } from 'ts-morph';
import type { ExpressFacts, HandlerRef, StaticString } from '../../../types/analyzer';
import { endpointId, routerId, unknownId } from '../../../graph/ids';
import type { FileContext } from '../../fileContext';
import { moduleRef } from '../../importResolver';
import { joinPaths, routePathFromParts, staticToText } from '../../pathUtils';
import { isStringLike } from '../../staticString';
import { unwrapExpression } from '../../symbolResolver';
import type { FrameworkAdapter, LinkContext } from '../shared/adapter';
import { flattenArgs, handlerRef } from '../shared/handlers';
import { emptySchema, mergeFields, type FieldSchema, type RequestSchema } from '../../../types/requestSchema';
import { zodObjectFields } from '../shared/schemaFromZod';

const METHODS = new Map([['get', 'GET'], ['post', 'POST'], ['put', 'PUT'], ['patch', 'PATCH'], ['delete', 'DELETE'], ['head', 'HEAD'], ['options', 'OPTIONS'], ['all', 'ALL']]);
const ROUTER_TYPES = /^(Application|Express|Router|IRouter|IRoute)$/;
const MAX_DEPTH = 10;

interface RouterInfo {
  id: string;
  name: string;
  kind: 'app' | 'router';
  path: string;
  line: number;
  column: number;
}

function factoryKind(call: Node): 'app' | 'router' | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const ref = moduleRef(call.getExpression());
  if (!ref || ref.module !== 'express') return undefined;
  if (ref.member === undefined) return 'app';
  if (ref.member === 'Router') return 'router';
  return undefined;
}

/** Finds the router/app a module exports (ES default export or `module.exports = x`). */
function routerExportedBy(ctx: FileContext, file: SourceFile, depth: number): RouterInfo | undefined {
  for (const st of file.getStatements()) {
    if (Node.isExportAssignment(st)) {
      const r = routerOf(ctx, st.getExpression(), depth + 1);
      if (r) return r;
    }
    if (Node.isExpressionStatement(st)) {
      const e = st.getExpression();
      if (Node.isBinaryExpression(e) && /^module\.exports$/.test(e.getLeft().getText())) {
        const r = routerOf(ctx, e.getRight(), depth + 1);
        if (r) return r;
      }
    }
  }
  return undefined;
}

function declInfo(ctx: FileContext, decl: Node, name: string, kind: 'app' | 'router'): RouterInfo | undefined {
  const rel = ctx.relPathOfFile(decl.getSourceFile());
  if (!rel) return undefined;
  return { id: routerId(rel, name), name, kind, path: rel, line: decl.getStartLineNumber(), column: decl.getStart() - decl.getStartLinePos() + 1 };
}

/** Is `expr` an Express app/router? Evidence comes from its initializer (express() / Router()) or a parameter typed as one. */
function routerOf(ctx: FileContext, expr: Node | undefined, depth = 0): RouterInfo | undefined {
  const e = unwrapExpression(expr);
  if (!e || depth > 4) return undefined;

  if (Node.isCallExpression(e)) {
    const kind = factoryKind(e);
    if (kind) return declInfo(ctx, e, `<inline@L${e.getStartLineNumber()}>`, kind);
    // require('./routes') inline
    const callee = e.getExpression();
    const arg = e.getArguments()[0];
    if (Node.isIdentifier(callee) && callee.getText() === 'require' && arg && Node.isStringLiteral(arg) && arg.getLiteralText().startsWith('.')) {
      const sf = e.getSourceFile();
      const res = ts.resolveModuleName(arg.getLiteralText(), sf.getFilePath(), sf.getProject().getCompilerOptions(), sf.getProject().getModuleResolutionHost());
      const target = res.resolvedModule ? sf.getProject().getSourceFile(res.resolvedModule.resolvedFileName) : undefined;
      if (target) {
        ctx.touch(target);
        return routerExportedBy(ctx, target, depth);
      }
    }
    return undefined;
  }
  if (!(Node.isIdentifier(e) || Node.isPropertyAccessExpression(e))) return undefined;

  const target = Node.isPropertyAccessExpression(e) ? e.getNameNode() : e;
  for (const d of ctx.resolve(target)) {
    if (Node.isVariableDeclaration(d)) {
      const nameNode = d.getNameNode();
      if (!Node.isIdentifier(nameNode)) continue;
      const init = unwrapExpression(d.getInitializer());
      const kind = init ? factoryKind(init) : undefined;
      if (kind) return declInfo(ctx, d, nameNode.getText(), kind);
      if (init && Node.isCallExpression(init)) {
        const viaRequire = routerOf(ctx, init, depth + 1);
        if (viaRequire) return viaRequire;
      }
    } else if (Node.isParameterDeclaration(d)) {
      const t = d.getTypeNode();
      const typeName = t && Node.isTypeReference(t) ? t.getTypeName().getText().replace(/^.*\./, '') : undefined;
      const nameNode = d.getNameNode();
      if (typeName && ROUTER_TYPES.test(typeName) && Node.isIdentifier(nameNode) && moduleRef(Node.isTypeReference(t!) ? t.getTypeName() : undefined)?.module === 'express') {
        const fn = d.getParent();
        const fnName = (fn as unknown as { getName?: () => string | undefined }).getName?.() ?? 'anonymous';
        return declInfo(ctx, d, `${fnName}.${nameNode.getText()}`, typeName === 'Router' || typeName === 'IRouter' ? 'router' : 'app');
      }
    } else if (Node.isExportAssignment(d)) {
      const r = routerOf(ctx, d.getExpression(), depth + 1);
      if (r) return r;
    }
  }
  return undefined;
}

const VALIDATOR_IN: Record<string, 'body' | 'query' | 'pathParams'> = { body: 'body', query: 'query', param: 'pathParams', check: 'body' };
const VALIDATOR_TYPE: Record<string, FieldSchema['type']> = { isString: 'string', isEmail: 'string', isURL: 'string', isUUID: 'string', isInt: 'number', isFloat: 'number', isNumeric: 'number', isBoolean: 'boolean', isArray: 'array', isObject: 'object' };

function setNested(fields: FieldSchema[], path: string[], leaf: FieldSchema): FieldSchema[] {
  const [head, ...rest] = path;
  if (!rest.length) return mergeFields(fields, [{ ...leaf, name: head }]);
  const existing = fields.find((f) => f.name === head);
  return mergeFields(fields, [{ name: head, type: 'object', required: leaf.required, fields: setNested(existing?.fields ?? [], rest, leaf) }]);
}

/** express-validator chains (`body('email').isEmail().optional()`) and zod validation middleware on a route. */
function routeSchema(ctx: FileContext, middleware: Node[], method: string): RequestSchema | undefined {
  const out = emptySchema();
  for (const node of middleware) {
    const e = unwrapExpression(node);
    if (!e || !Node.isCallExpression(e)) {
      const zf = e ? zodObjectFields(ctx, e) : undefined;
      if (zf) {
        out[/^(POST|PUT|PATCH|ALL)$/.test(method) ? 'body' : 'query'] = mergeFields(out[/^(POST|PUT|PATCH|ALL)$/.test(method) ? 'body' : 'query'], zf);
        out.sources.push('zod schema');
      }
      continue;
    }
    // walk down the call chain to the root call: body('x').isEmail().optional() → body('x')
    let cur: Node = e;
    let optional = false;
    let type: FieldSchema['type'] = 'unknown';
    let example: string | undefined;
    let enumValues: (string | number)[] | undefined;
    while (Node.isCallExpression(cur)) {
      const callee = unwrapExpression(cur.getExpression());
      if (callee && Node.isPropertyAccessExpression(callee)) {
        const m = callee.getName();
        if (m === 'optional') optional = true;
        if (VALIDATOR_TYPE[m]) type = VALIDATOR_TYPE[m];
        if (m === 'isEmail') example = 'name@example.com';
        if (m === 'isIn') {
          const arr = cur.getArguments()[0] ? unwrapExpression(cur.getArguments()[0]) : undefined;
          if (arr && Node.isArrayLiteralExpression(arr)) enumValues = arr.getElements().flatMap((x): (string | number)[] => (Node.isStringLiteral(x) ? [x.getLiteralText()] : Node.isNumericLiteral(x) ? [Number(x.getText())] : []));
        }
        cur = unwrapExpression(callee.getExpression())!;
        continue;
      }
      break;
    }
    if (Node.isCallExpression(cur)) {
      const root = unwrapExpression(cur.getExpression());
      const ref = root && Node.isIdentifier(root) ? moduleRef(root) : undefined;
      if (ref?.module === 'express-validator' && VALIDATOR_IN[ref.member ?? root!.getText()]) {
        const a = cur.getArguments()[0] ? unwrapExpression(cur.getArguments()[0]) : undefined;
        if (a && (Node.isStringLiteral(a) || Node.isNoSubstitutionTemplateLiteral(a))) {
          const target = VALIDATOR_IN[ref.member ?? root!.getText()];
          const parts = a.getLiteralText().split('.').filter((x) => x && x !== '*');
          if (parts.length) {
            const leaf: FieldSchema = { name: parts[parts.length - 1], type, required: !optional, ...(example ? { example } : {}), ...(enumValues ? { enumValues } : {}) };
            out[target] = setNested(out[target], parts, leaf);
            if (!out.sources.includes('express-validator')) out.sources.push('express-validator');
          }
          continue;
        }
      }
    }
    // validate(createUserSchema) / validateBody(z.object({...})): a zod object passed to a middleware factory
    for (const arg of e.getArguments()) {
      const zf = zodObjectFields(ctx, arg);
      if (zf) {
        const t = /^(POST|PUT|PATCH|ALL)$/.test(method) ? 'body' : 'query';
        out[t] = mergeFields(out[t], zf);
        out.sources.push('zod schema');
      }
    }
  }
  return out.body.length || out.query.length || out.pathParams.length ? out : undefined;
}

function extract(ctx: FileContext): void {
  const facts: ExpressFacts = { routers: [], routes: [], uses: [] };
  const seenRouters = new Set<string>();
  const register = (r: RouterInfo) => {
    if (r.path !== ctx.path || seenRouters.has(r.id)) return;
    seenRouters.add(r.id);
    facts.routers.push({ id: r.id, name: r.name, line: r.line, column: r.column, kind: r.kind });
  };

  // routers declared in this file
  for (const d of ctx.nodesOf<import('ts-morph').VariableDeclaration>(SyntaxKind.VariableDeclaration)) {
    const init = unwrapExpression(d.getInitializer());
    const nameNode = d.getNameNode();
    const kind = init ? factoryKind(init) : undefined;
    if (kind && Node.isIdentifier(nameNode)) {
      const info = declInfo(ctx, d, nameNode.getText(), kind);
      if (info) register(info);
    }
  }
  for (const a of ctx.nodesOf<import('ts-morph').ExportAssignment>(SyntaxKind.ExportAssignment)) {
    const kind = factoryKind(unwrapExpression(a.getExpression())!);
    const info = kind ? declInfo(ctx, a, 'default', kind) : undefined;
    if (info) register(info);
  }

  const pathsOf = (node: Node): { path: StaticString; ok: boolean }[] => {
    const e = unwrapExpression(node);
    if (e && Node.isArrayLiteralExpression(e)) return e.getElements().flatMap((x) => pathsOf(x));
    if (e && (Node.isRegularExpressionLiteral(e))) {
      ctx.warn('dynamic-route', `Regular-expression route path ${e.getText()} is not supported`, node);
      return [];
    }
    const v = ctx.evalPath(e);
    return v ? [{ path: v, ok: true }] : [];
  };

  const handleMethodCall = (call: CallExpression, router: RouterInfo, methods: string[], pathNode: Node | undefined, handlerArgs: Node[]) => {
    const pathList = pathNode ? pathsOf(pathNode) : [{ path: [''] as StaticString, ok: true }];
    const flat = flattenArgs(handlerArgs);
    if (flat.length === 0 || pathList.length === 0) return;
    register(router);
    for (const { path } of pathList) {
      const label = `${methods[0]} ${staticToText(path) || '/'}`;
      const refs = flat.map((a) => handlerRef(ctx, a, label));
      const handler = refs[refs.length - 1];
      const schema = routeSchema(ctx, flat.slice(0, -1), methods[0]);
      facts.routes.push({ router: router.id, methods, path, line: call.getStartLineNumber(), handlers: [handler], middleware: refs.slice(0, -1), ...(schema ? { schema } : {}) });
    }
  };

  for (const call of ctx.nodesOf<CallExpression>(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const name = callee.getName();
    const method = METHODS.get(name);
    if (!method && name !== 'use') continue;
    const recv = unwrapExpression(callee.getExpression());
    if (!recv) continue;
    const args = call.getArguments();

    if (method) {
      // router.route('/x').get(h).post(h)
      let base: Node | undefined = recv;
      let routePath: Node | undefined;
      while (base && Node.isCallExpression(base)) {
        const c = base.getExpression();
        if (Node.isPropertyAccessExpression(c) && c.getName() === 'route') {
          routePath = base.getArguments()[0];
          base = unwrapExpression(c.getExpression());
          break;
        }
        if (Node.isPropertyAccessExpression(c) && METHODS.has(c.getName())) base = unwrapExpression(c.getExpression());
        else break;
      }
      if (routePath) {
        const router = routerOf(ctx, base);
        if (router) handleMethodCall(call, router, [method], routePath, args);
        continue;
      }
      const router = routerOf(ctx, recv);
      if (!router) continue;
      if (args.length === 1 && isStringLike(args[0])) continue; // app.get('setting')
      const a0 = unwrapExpression(args[0]);
      const first = args[0] && a0 && (ctx.evalPath(a0) !== undefined || Node.isArrayLiteralExpression(a0) || Node.isRegularExpressionLiteral(a0)) ? args[0] : undefined;
      if (!first) continue; // a verb call without a path is not a route registration
      handleMethodCall(call, router, [method], first, args.slice(1));
      continue;
    }

    // use(): middleware and router mounting
    const router = routerOf(ctx, recv);
    if (!router) continue;
    register(router);
    const pathParts = args[0] !== undefined ? ctx.evalPath(args[0]) : undefined;
    const hasPath = pathParts !== undefined;
    const rest = flattenArgs(hasPath ? args.slice(1) : args);
    const middleware: HandlerRef[] = [];
    let mount: { routerId?: string; text: string } | undefined;
    for (const a of rest) {
      const child = routerOf(ctx, a);
      if (child) {
        register(child);
        mount = { routerId: child.id, text: a.getText().slice(0, 60) };
        continue;
      }
      const ref = handlerRef(ctx, a, `middleware`);
      const ae = unwrapExpression(a);
      const looksLikeRouter = hasPath && (Node.isIdentifier(ae!) || Node.isPropertyAccessExpression(ae!) || Node.isElementAccessExpression(ae!) || (Node.isCallExpression(ae!) && ae.getExpression().getText() === 'require'));
      if (!ref.id && looksLikeRouter && a === rest[rest.length - 1]) {
        mount = { text: a.getText().slice(0, 60) };
        ctx.warn('unresolved-mount', `Cannot resolve router mounted at ${staticToText(pathParts ?? [])}: ${a.getText().slice(0, 60)}`, call);
      } else middleware.push(ref);
    }
    facts.uses.push({ router: router.id, path: pathParts, line: call.getStartLineNumber(), middleware, mount });
  }

  if (facts.routers.length || facts.routes.length || facts.uses.length) ctx.facts.express = facts;
}

interface ChainEntry {
  ref: HandlerRef;
  /** Full path prefix the middleware applies under. */
  scope: string;
  file: string;
  line: number;
  explanation: string;
  inferred: boolean;
}

function underScope(fullPath: string, scope: string): boolean {
  if (scope === '/' || scope === '') return true;
  return fullPath === scope || fullPath.startsWith(scope + '/') || fullPath.startsWith(scope + '/:');
}

function link(ctx: LinkContext): void {
  const { graph, facts, diagnostics } = ctx;
  interface Rec { info: ExpressFacts['routers'][number]; file: string }
  const routers = new Map<string, Rec>();
  const routes = new Map<string, { file: string; r: ExpressFacts['routes'][number] }[]>();
  const uses = new Map<string, { file: string; u: ExpressFacts['uses'][number] }[]>();
  const mounted = new Set<string>();
  for (const [file, f] of [...facts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const ex = f.express;
    if (!ex) continue;
    for (const r of ex.routers) routers.set(r.id, { info: r, file });
    for (const r of ex.routes) (routes.get(r.router) ?? routes.set(r.router, []).get(r.router)!).push({ file, r });
    for (const u of ex.uses) {
      (uses.get(u.router) ?? uses.set(u.router, []).get(u.router)!).push({ file, u });
      if (u.mount?.routerId) mounted.add(u.mount.routerId);
    }
  }
  if (routers.size === 0) return;

  const addRouterNode = (id: string) => {
    const rec = routers.get(id);
    if (!rec || graph.hasNode(id)) return;
    graph.addNode({ id, kind: 'route', name: rec.info.name, path: rec.file, startLine: rec.info.line, startColumn: rec.info.column, metadata: { framework: 'express', routerKind: rec.info.kind } });
  };

  const visit = (id: string, prefix: string, prefixUnknown: boolean, chain: ChainEntry[], stack: string[]) => {
    const rec = routers.get(id);
    if (!rec || stack.includes(id) || stack.length > MAX_DEPTH) return;
    const here = [...stack, id];
    const myUses = (uses.get(id) ?? []).filter((x) => !x.u.mount && x.u.middleware.length > 0);

    const applicable = (beforeFile: string, beforeLine: number, scopePrefix: string): ChainEntry[] =>
      myUses
        .map(({ file, u }): ChainEntry[] => {
          const local = u.path ? routePathFromParts(u.path).path : '/';
          const sameFile = file === beforeFile;
          if (sameFile && u.line > beforeLine) return []; // registered after: does not apply to routes defined before it
          return u.middleware.map((ref) => ({
            ref,
            scope: joinPaths(scopePrefix, local),
            file,
            line: u.line,
            explanation: sameFile ? `${ref.text} registered with use() before this route` : `${ref.text} registered with use() on the same router (declaration order across files unknown)`,
            inferred: true,
          }));
        })
        .flat();

    for (const { file, r } of routes.get(id) ?? []) {
      const { path: local, holes } = routePathFromParts(r.path);
      const full = joinPaths(prefix, local);
      const mw: ChainEntry[] = [
        ...chain,
        ...applicable(file, r.line, prefix),
        ...r.middleware.map((ref): ChainEntry => ({ ref, scope: '/', file, line: ref.line, explanation: `route-level middleware ${ref.text}`, inferred: false })),
      ];
      for (const method of r.methods) {
        const eid = endpointId(method, full, file, r.line);
        if (r.schema) ctx.schemas.set(eid, r.schema);
        const dynamic = holes > 0;
        graph.addNode({
          id: eid,
          kind: 'api-endpoint',
          name: `${method} ${full}`,
          path: file,
          startLine: r.line,
          metadata: { method, path: full, framework: 'express', router: rec.info.name, ...(dynamic ? { dynamic: true } : {}), ...(prefixUnknown ? { prefixUnknown: true } : {}) },
        });
        if (dynamic) diagnostics.push({ severity: 'info', code: 'dynamic-route', message: `Route path ${staticToText(r.path)} contains dynamic parts; treated as parameters`, path: file, line: r.line });
        const uncertain = dynamic || prefixUnknown;
        const reason = prefixUnknown ? 'router is never mounted in analyzed code; mount prefix unknown' : dynamic ? 'route path contains dynamic parts' : undefined;
        for (const h of r.handlers) {
          if (h.id && ctx.ensureSymbol(h.id)) {
            graph.addEdge({
              source: eid,
              target: h.id,
              kind: 'handles-route',
              evidence: { path: file, line: r.line, explanation: `${method} ${full} is handled by ${h.text}${h.note ? ` (${h.note})` : ''}` },
              confidence: uncertain ? 'medium' : h.note?.startsWith('factory') ? 'medium' : 'high',
              resolution: uncertain || h.note?.startsWith('factory') ? 'inferred' : 'resolved',
              reason,
            });
          } else {
            const uid = unknownId(`handler:${file}:${h.line}`);
            graph.addNode({ id: uid, kind: 'unknown', name: `Unresolved handler: ${h.text}`, path: file, startLine: h.line, metadata: { reason: 'unresolved-handler' } });
            graph.addEdge({ source: eid, target: uid, kind: 'handles-route', evidence: { path: file, line: r.line, explanation: `handler ${h.text} could not be resolved` }, confidence: 'low', resolution: 'unresolved', reason: h.note ?? 'handler is not statically resolvable' });
            diagnostics.push({ severity: 'warning', code: 'unresolved-handler', message: `${method} ${full}: handler ${h.text} ${h.note ?? 'is not resolvable'}`, path: file, line: h.line });
          }
        }
        for (const m of mw) {
          if (!m.ref.id || !underScope(full, m.scope) || !ctx.ensureSymbol(m.ref.id)) continue;
          graph.setKind(m.ref.id, 'middleware');
          graph.addEdge({
            source: eid,
            target: m.ref.id,
            kind: 'uses-middleware',
            evidence: { path: m.file, line: m.line, explanation: m.explanation },
            confidence: m.inferred ? 'medium' : 'high',
            resolution: m.inferred ? 'inferred' : 'resolved',
            reason: m.inferred ? 'middleware order and path filters are approximated from source position' : undefined,
          });
        }
      }
    }

    for (const { file, u } of (uses.get(id) ?? []).filter((x) => x.u.mount)) {
      const mount = u.mount!;
      const local = u.path ? routePathFromParts(u.path).path : '/';
      if (!mount.routerId) {
        const uid = unknownId(`mount:${file}:${u.line}`);
        graph.addNode({ id: uid, kind: 'unknown', name: `Unresolved router: ${mount.text}`, path: file, startLine: u.line, metadata: { reason: 'unresolved-mount' } });
        addRouterNode(id);
        graph.addEdge({ source: id, target: uid, kind: 'mounts-router', evidence: { path: file, line: u.line, explanation: `mounts ${mount.text} at ${local}` }, confidence: 'low', resolution: 'unresolved', reason: 'router expression could not be resolved' });
        continue;
      }
      const childPrefix = joinPaths(prefix, local);
      addRouterNode(id);
      addRouterNode(mount.routerId);
      graph.addEdge({
        source: id,
        target: mount.routerId,
        kind: 'mounts-router',
        evidence: { path: file, line: u.line, explanation: `mounts router ${mount.text} at ${childPrefix}` },
        confidence: prefixUnknown ? 'medium' : 'high',
        resolution: prefixUnknown ? 'inferred' : 'resolved',
      });
      const inherited: ChainEntry[] = [
        ...chain,
        ...applicable(file, u.line, prefix),
        ...u.middleware.map((ref): ChainEntry => ({ ref, scope: childPrefix, file, line: u.line, explanation: `middleware ${ref.text} on mount ${childPrefix}`, inferred: false })),
      ];
      visit(mount.routerId, childPrefix, prefixUnknown, inherited, here);
    }
  };

  const roots = [...routers.keys()].filter((id) => !mounted.has(id)).sort();
  for (const id of roots) {
    const rec = routers.get(id)!;
    // a router that nothing mounts has an unknown prefix; an app is a legitimate root
    const orphanRouter = rec.info.kind === 'router' && (routes.get(id)?.length ?? 0) > 0;
    visit(id, '/', orphanRouter, [], []);
    if (orphanRouter) addRouterNode(id);
  }
}

export const expressAdapter: FrameworkAdapter = { name: 'express', extract, link };

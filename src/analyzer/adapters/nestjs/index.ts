import { Node, SyntaxKind, type ClassDeclaration, type Decorator, type MethodDeclaration } from 'ts-morph';
import type { HandlerRef, NestClassFact, NestFacts, NestRouteFact, StaticString } from '../../../types/analyzer';
import type { GraphEdge } from '../../../types/graph';
import { endpointId, symId } from '../../../graph/ids';
import type { FileContext } from '../../fileContext';
import { fileImports, moduleRef } from '../../importResolver';
import { joinPaths, routePathFromParts, staticToText } from '../../pathUtils';
import { unwrapExpression } from '../../symbolResolver';
import { bindingOfMember } from '../database/bindings';
import type { FrameworkAdapter, LinkContext } from '../shared/adapter';
import { decoratorName, decoratorsFrom, firstArg } from '../shared/decorators';
import { emptySchema, mergeFields, type RequestSchema } from '../../../types/requestSchema';
import { schemaFieldOfType, schemaFieldsOfType } from '../shared/schemaFromType';

const COMMON = ['@nestjs/common'];
const HTTP_DECORATORS = new Map([['Get', 'GET'], ['Post', 'POST'], ['Put', 'PUT'], ['Patch', 'PATCH'], ['Delete', 'DELETE'], ['All', 'ALL'], ['Options', 'OPTIONS'], ['Head', 'HEAD']]);

function implementsFromNest(cls: ClassDeclaration, name: string): boolean {
  return cls.getImplements().some((i) => {
    const e = i.getExpression();
    const ref = moduleRef(e);
    return ref?.module === '@nestjs/common' && (ref.member ?? e.getText()) === name;
  });
}

/** Class a guard/interceptor/provider argument refers to: `AuthGuard`, `new AuthGuard()`, `forwardRef(() => X)`. */
function classRef(ctx: FileContext, arg: Node): HandlerRef {
  const line = arg.getStartLineNumber();
  const text = arg.getText().replace(/\s+/g, ' ').slice(0, 60);
  let e = unwrapExpression(arg);
  if (e && Node.isNewExpression(e)) e = unwrapExpression(e.getExpression());
  if (e && Node.isCallExpression(e)) {
    const callee = e.getExpression();
    if (callee.getText() === 'forwardRef') {
      const fn = unwrapExpression(e.getArguments()[0]);
      const body = fn && Node.isArrowFunction(fn) ? unwrapExpression(fn.getBody()) : undefined;
      if (body) e = body;
    } else {
      // AuthGuard('jwt') from a library is a call, not a workspace class
      const target = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
      for (const d of ctx.resolve(target)) {
        const sid = ctx.symbolIdOf(d);
        if (sid) return { id: sid.id, text, line };
      }
      return { text, line, note: 'library or dynamic provider' };
    }
  }
  if (e && (Node.isIdentifier(e) || Node.isPropertyAccessExpression(e))) {
    for (const d of ctx.resolve(Node.isPropertyAccessExpression(e) ? e.getNameNode() : e)) {
      if (Node.isClassDeclaration(d)) {
        const sid = ctx.symbolIdOf(d);
        if (sid) return { id: sid.id, text, line };
      }
    }
  }
  return { text, line, note: 'could not resolve to a workspace class' };
}

function usesOf(ctx: FileContext, node: Node, names: string[]): HandlerRef[] {
  const out: HandlerRef[] = [];
  for (const d of decoratorsFrom(node, COMMON, names)) for (const a of d.getArguments()) out.push(classRef(ctx, a));
  return out;
}

function pathsOfDecorator(ctx: FileContext, d: Decorator): StaticString[] {
  const a = firstArg(d);
  if (!a) return [['']];
  if (Node.isArrayLiteralExpression(a)) return a.getElements().flatMap((x) => { const v = ctx.evalPath(x); return v ? [v] : []; });
  if (Node.isObjectLiteralExpression(a)) {
    const p = a.getProperty('path');
    if (p && Node.isPropertyAssignment(p) && p.getInitializer()) return [ctx.staticValue(p.getInitializer(), d)];
    return [['']];
  }
  const v = ctx.evalPath(a);
  if (v) return [v];
  ctx.warn('dynamic-route', `Decorator path ${a.getText().slice(0, 60)} is not statically resolvable`, d);
  return [[{ hole: a.getText().slice(0, 40), reason: 'expr' }]];
}

/** `@ApiOperation({ summary: '...' })` (from @nestjs/swagger) is the author's own description of the route. */
function apiOperationSummary(m: MethodDeclaration): string | undefined {
  for (const d of m.getDecorators()) {
    if (d.getName() !== 'ApiOperation') continue;
    const arg = d.getArguments()[0] ? unwrapExpression(d.getArguments()[0]) : undefined;
    if (!arg || !Node.isObjectLiteralExpression(arg)) continue;
    for (const key of ['summary', 'description']) {
      const p = arg.getProperty(key);
      const init = p && Node.isPropertyAssignment(p) ? unwrapExpression(p.getInitializer()) : undefined;
      if (init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) return init.getLiteralText();
    }
  }
  return undefined;
}

/** `@Param('id')`, `@Query('q')`, `@Query() dto: QueryDto`, `@Body() dto: CreateDto`, `@Body('name')` → what the route accepts. */
function nestSchema(ctx: FileContext, m: MethodDeclaration): RequestSchema | undefined {
  const out = emptySchema();
  for (const p of m.getParameters()) {
    const type = p.getTypeNode();
    for (const d of decoratorsFrom(p, COMMON, ['Param', 'Query', 'Body'])) {
      const kind = decoratorName(d);
      const keyNode = firstArg(d);
      const key = keyNode && (Node.isStringLiteral(keyNode) || Node.isNoSubstitutionTemplateLiteral(keyNode)) ? keyNode.getLiteralText() : undefined;
      const required = !p.hasQuestionToken() && !p.getInitializer();
      const target = kind === 'Param' ? 'pathParams' : kind === 'Query' ? 'query' : 'body';
      if (key) {
        out[target] = mergeFields(out[target], [schemaFieldOfType(ctx, key, type, kind === 'Param' ? true : required)]);
      } else {
        const fields = schemaFieldsOfType(ctx, type);
        if (fields) {
          out[target] = mergeFields(out[target], kind === 'Query' ? fields : fields);
          out.sources.push(`${type!.getText()} (${kind === 'Body' ? 'request body' : kind === 'Query' ? 'query' : 'path params'} DTO)`);
        }
      }
    }
  }
  return out.pathParams.length || out.query.length || out.body.length ? out : undefined;
}

function extract(ctx: FileContext): void {
  const importsNest = fileImports(ctx.sf, ['@nestjs/common', '@nestjs/core']);
  if (!importsNest) return;
  const facts: NestFacts = { classes: [] };
  const modules: NonNullable<NestFacts['modules']> = [];

  // app.setGlobalPrefix('api')
  for (const call of ctx.nodesOf<import('ts-morph').CallExpression>(SyntaxKind.CallExpression)) {
    const c = call.getExpression();
    if (Node.isPropertyAccessExpression(c) && c.getName() === 'setGlobalPrefix' && call.getArguments()[0]) {
      facts.globalPrefix = ctx.staticValue(call.getArguments()[0], call);
    }
  }

  for (const cls of ctx.nodesOf<ClassDeclaration>(SyntaxKind.ClassDeclaration)) {
    const name = cls.getName();
    if (!name) continue;
    const classId = symId(ctx.path, name);
    const controllerDec = decoratorsFrom(cls, COMMON, ['Controller'])[0];
    const injectable = decoratorsFrom(cls, COMMON, ['Injectable'])[0];
    const moduleDec = decoratorsFrom(cls, COMMON, ['Module'])[0];
    const isGuard = implementsFromNest(cls, 'CanActivate');
    const isInterceptor = implementsFromNest(cls, 'NestInterceptor');
    const isMiddleware = implementsFromNest(cls, 'NestMiddleware');

    const kind = controllerDec ? 'controller' : isGuard ? 'guard' : isInterceptor ? 'interceptor' : isMiddleware ? 'middleware' : injectable ? 'service' : undefined;
    const controllerPaths = controllerDec ? pathsOfDecorator(ctx, controllerDec) : [];
    if (kind) {
      ctx.classify(classId, kind, { framework: 'nestjs', ...(controllerDec ? { prefix: staticToText(controllerPaths[0] ?? ['']) } : {}) });
      for (const m of cls.getMethods()) {
        const summary = apiOperationSummary(m);
        ctx.classify(symId(ctx.path, `${name}.${m.getName()}`), kind, { framework: 'nestjs', class: name, ...(summary ? { description: summary } : {}) });
      }
    }
    if (moduleDec) {
      ctx.classify(classId, 'function', { nestRole: 'module' });
      const arg = firstArg(moduleDec);
      const ids = (prop: string): string[] => {
        if (!arg || !Node.isObjectLiteralExpression(arg)) return [];
        const p = arg.getProperty(prop);
        const init = p && Node.isPropertyAssignment(p) ? unwrapExpression(p.getInitializer()) : undefined;
        if (!init || !Node.isArrayLiteralExpression(init)) return [];
        return init.getElements().flatMap((el) => {
          const ref = classRef(ctx, Node.isObjectLiteralExpression(el) ? (((el.getProperty('useClass') as import('ts-morph').PropertyAssignment | undefined)?.getInitializer()) ?? el) : el);
          return ref.id ? [ref.id] : [];
        });
      };
      modules.push({ id: classId, name, line: cls.getStartLineNumber(), controllers: ids('controllers'), providers: ids('providers') });
    }

    // --- DI: constructor parameters and @Inject() properties -----------------------------------
    const injectionSites: Node[] = [...cls.getConstructors().flatMap((c) => c.getParameters()), ...cls.getProperties().filter((p) => decoratorsFrom(p, COMMON, ['Inject'])[0])];
    const emittedNodes = new Set<string>();
    for (const site of injectionSites) {
      const line = site.getStartLineNumber();
      const binding = bindingOfMember(ctx, site);
      if (binding?.target) {
        const t = binding.target;
        if (!emittedNodes.has(t.id)) {
          emittedNodes.add(t.id);
          ctx.facts.nodes.push({ id: t.id, kind: t.kind, name: t.name, path: t.path, startLine: t.line, metadata: t.meta });
        }
        ctx.facts.edges.push(injectEdge(ctx, classId, t.id, line, `${name} injects ${t.name} (${binding.evidence})`));
        continue;
      }
      let target: HandlerRef | undefined;
      const injectDec = Node.isDecoratable(site) ? decoratorsFrom(site, COMMON, ['Inject'])[0] : undefined;
      if (injectDec && injectDec.getArguments()[0]) target = classRef(ctx, injectDec.getArguments()[0]);
      if (!target?.id) {
        const t = (site as unknown as { getTypeNode?: () => Node | undefined }).getTypeNode?.();
        if (t && Node.isTypeReference(t)) {
          const tn = t.getTypeName();
          for (const d of ctx.resolve(tn)) {
            if (Node.isClassDeclaration(d)) {
              const sid = ctx.symbolIdOf(d);
              if (sid) {
                target = { id: sid.id, text: tn.getText(), line };
                break;
              }
            }
          }
        }
      }
      if (target?.id && target.id !== classId) {
        ctx.facts.edges.push(injectEdge(ctx, classId, target.id, line, `${name} receives ${target.text} through dependency injection`));
      }
    }

    // --- routes ------------------------------------------------------------------------------------
    if (!controllerDec) {
      if (kind || moduleDec) facts.classes.push({ id: classId, name, line: cls.getStartLineNumber(), isController: false, guards: [], interceptors: [], routes: [] });
      continue;
    }
    const classFact: NestClassFact = {
      id: classId,
      name,
      line: cls.getStartLineNumber(),
      isController: true,
      controllerPath: controllerPaths[0] ?? [''],
      guards: usesOf(ctx, cls, ['UseGuards']),
      interceptors: usesOf(ctx, cls, ['UseInterceptors']),
      routes: [],
    };
    for (const m of cls.getMethods() as MethodDeclaration[]) {
      for (const d of decoratorsFrom(m, COMMON, [...HTTP_DECORATORS.keys()])) {
        const method = HTTP_DECORATORS.get(moduleRef(d.getNameNode())?.member ?? d.getName());
        if (!method) continue;
        for (const path of pathsOfDecorator(ctx, d)) {
          const route: NestRouteFact = {
            method,
            path,
            methodId: symId(ctx.path, `${name}.${m.getName()}`),
            methodName: `${name}.${m.getName()}`,
            line: d.getStartLineNumber(),
            guards: usesOf(ctx, m, ['UseGuards']),
            interceptors: usesOf(ctx, m, ['UseInterceptors']),
            schema: nestSchema(ctx, m),
          };
          classFact.routes.push(route);
        }
      }
    }
    facts.classes.push(classFact);
  }

  if (modules.length) facts.modules = modules;
  if (facts.classes.length || facts.globalPrefix || facts.modules) ctx.facts.nest = facts;
}

function injectEdge(ctx: FileContext, source: string, target: string, line: number, explanation: string): GraphEdge {
  return { id: `injects|${source}|${target}`, source, target, kind: 'injects', evidence: { path: ctx.path, line, explanation }, confidence: 'high', resolution: 'resolved' };
}

function link(ctx: LinkContext): void {
  const { graph, facts, diagnostics } = ctx;
  const prefixes = new Map<string, { parts: StaticString; file: string }>();
  for (const [file, f] of facts) if (f.nest?.globalPrefix) prefixes.set(ctx.packageDirOf(file), { parts: f.nest.globalPrefix, file });
  const distinct = new Set([...prefixes.values()].map((p) => routePathFromParts(p.parts).path));
  const registered = new Map<string, string[]>();

  for (const [file, f] of [...facts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    for (const m of f.nest?.modules ?? []) {
      for (const id of [...m.controllers, ...m.providers]) (registered.get(id) ?? registered.set(id, []).get(id)!).push(m.name);
    }
    for (const c of f.nest?.classes ?? []) {
      if (!c.isController) continue;
      const own = prefixes.get(ctx.packageDirOf(file));
      let prefixParts: StaticString | undefined = own?.parts;
      let prefixInferred = false;
      if (!own && distinct.size === 1) {
        prefixParts = [...prefixes.values()][0].parts;
        prefixInferred = true;
      }
      const prefix = prefixParts ? routePathFromParts(prefixParts) : { path: '/', holes: 0 };
      for (const r of c.routes) {
        const cp = routePathFromParts(c.controllerPath ?? ['']);
        const rp = routePathFromParts(r.path);
        const full = joinPaths(prefix.path, cp.path, rp.path);
        const dynamic = cp.holes + rp.holes + prefix.holes > 0;
        const eid = endpointId(r.method, full, file, r.line);
        graph.addNode({
          id: eid,
          kind: 'api-endpoint',
          name: `${r.method} ${full}`,
          path: file,
          startLine: r.line,
          metadata: { method: r.method, path: full, framework: 'nestjs', controller: c.name, ...(dynamic ? { dynamic: true } : {}), ...(prefixInferred ? { globalPrefixInferred: true } : {}) },
        });
        if (dynamic) diagnostics.push({ severity: 'info', code: 'dynamic-route', message: `Route ${r.method} ${full} contains dynamic path parts`, path: file, line: r.line });
        const uncertain = dynamic || prefixInferred;
        const reason = dynamic ? 'route path contains dynamic parts' : prefixInferred ? 'global prefix taken from another package (setGlobalPrefix found in exactly one place)' : undefined;
        if (r.schema) ctx.schemas.set(eid, r.schema);
        if (ctx.ensureSymbol(r.methodId)) {
          graph.addEdge({
            source: eid,
            target: r.methodId,
            kind: 'handles-route',
            evidence: { path: file, line: r.line, explanation: `${r.method} ${full} is handled by ${r.methodName}${prefix.path !== '/' ? ` (global prefix ${prefix.path})` : ''}` },
            confidence: uncertain ? 'medium' : 'high',
            resolution: uncertain ? 'inferred' : 'resolved',
            reason,
          });
        }
        const attach = (refs: HandlerRef[], kind: 'guard' | 'interceptor', scope: string) => {
          for (const ref of refs) {
            let target = ref.id;
            if (target && !ctx.ensureSymbol(target)) target = undefined;
            if (target) graph.setKind(target, kind);
            else {
              target = `${kind}:${ref.text}`;
              graph.addNode({ id: target, kind, name: ref.text, metadata: { external: true, reason: ref.note ?? 'not a workspace class' } });
            }
            graph.addEdge({
              source: eid,
              target,
              kind: kind === 'guard' ? 'uses-guard' : 'uses-middleware',
              evidence: { path: file, line: ref.line, explanation: `${scope}-level ${kind === 'guard' ? '@UseGuards' : '@UseInterceptors'}(${ref.text})` },
              confidence: ref.id ? 'high' : 'medium',
              resolution: ref.id ? 'resolved' : 'inferred',
              reason: ref.id ? undefined : ref.note,
            });
          }
        };
        attach(c.guards, 'guard', 'class');
        attach(r.guards, 'guard', 'method');
        attach(c.interceptors, 'interceptor', 'class');
        attach(r.interceptors, 'interceptor', 'method');
      }
    }
  }

  // module registration: recorded as node metadata; unregistered controllers are reported, never assumed instantiated
  for (const [id, mods] of registered) {
    if (!ctx.ensureSymbol(id)) continue;
    const n = graph.getNode(id);
    if (n) n.metadata = { ...n.metadata, registeredIn: [...new Set(mods)].sort() };
  }
  const anyModule = [...facts.values()].some((f) => (f.nest?.modules?.length ?? 0) > 0);
  for (const [file, f] of facts) {
    for (const c of f.nest?.classes ?? []) {
      if (anyModule && c.isController && !registered.has(c.id)) {
        diagnostics.push({ severity: 'info', code: 'config', message: `Controller ${c.name} is not registered in any @Module found in the workspace`, path: file, line: c.line });
      }
    }
  }
}

export const nestAdapter: FrameworkAdapter = { name: 'nestjs', extract, link };

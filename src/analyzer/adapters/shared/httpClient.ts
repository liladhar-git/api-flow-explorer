import { Node, SyntaxKind, type CallExpression } from 'ts-morph';
import type { RequestFact, StaticString } from '../../../types/analyzer';
import { requestId } from '../../../graph/ids';
import type { FileContext } from '../../fileContext';
import { fileImports, moduleRef } from '../../importResolver';
import { evalString } from '../../staticString';
import { describeDeclaration, unwrapExpression } from '../../symbolResolver';
import type { FrameworkAdapter } from './adapter';
import { MAX_FIELDS_PER_LEVEL, MAX_SCHEMA_DEPTH, type FieldSchema } from '../../../types/requestSchema';
import { schemaFieldOfType, schemaFieldsOfType } from './schemaFromType';

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const FETCH_MODULES = ['node-fetch', 'cross-fetch', 'isomorphic-unfetch', 'isomorphic-fetch', 'undici', 'whatwg-fetch', 'unfetch'];

function propInit(obj: Node | undefined, name: string): { found: boolean; init?: Node } {
  const o = unwrapExpression(obj);
  if (!o || !Node.isObjectLiteralExpression(o)) return { found: false };
  const p = o.getProperty(name);
  if (!p) return { found: false };
  if (Node.isPropertyAssignment(p)) return { found: true, init: p.getInitializer() };
  if (Node.isShorthandPropertyAssignment(p)) return { found: true, init: p.getNameNode() };
  return { found: true };
}

const hasSpread = (obj: Node | undefined): boolean => {
  const o = unwrapExpression(obj);
  return !!o && Node.isObjectLiteralExpression(o) && o.getProperties().some((p) => Node.isSpreadAssignment(p));
};

/** Base URL of `axios.create({ baseURL })`, found through the declaration the receiver resolves to (possibly in another file). */
function axiosInstance(ctx: FileContext, recv: Node): { isAxios: boolean; base?: StaticString } {
  const direct = moduleRef(recv);
  if (direct?.module === 'axios' && direct.member === undefined) return { isAxios: true };
  const e = unwrapExpression(recv);
  if (!e || !(Node.isIdentifier(e) || Node.isPropertyAccessExpression(e))) return { isAxios: false };
  for (const d of ctx.resolve(Node.isPropertyAccessExpression(e) ? e.getNameNode() : e)) {
    const decls = Node.isVariableDeclaration(d) ? [d] : [];
    for (const v of decls) {
      const init = unwrapExpression(v.getInitializer());
      if (init && Node.isCallExpression(init)) {
        const ref = moduleRef(init.getExpression());
        if (ref?.module === 'axios' && ref.member === 'create') {
          const { init: baseNode } = propInit(init.getArguments()[0], 'baseURL');
          return { isAxios: true, base: baseNode ? evalString(baseNode, { touched: (n) => ctx.touch(n) }) : undefined };
        }
      }
    }
    // an instance whose type is declared as AxiosInstance
    if (Node.isParameterDeclaration(d) || Node.isVariableDeclaration(d) || Node.isPropertyDeclaration(d)) {
      const t = d.getTypeNode();
      if (t && Node.isTypeReference(t) && /^Axios(Instance)?$/.test(t.getTypeName().getText()) && moduleRef(t.getTypeName())?.module === 'axios') return { isAxios: true };
    }
  }
  return { isAxios: false };
}

/** Type, and an example when it is a literal, of an expression written in a request payload. */
function valueField(ctx: FileContext, name: string, value: Node | undefined, depth: number): FieldSchema {
  const e = value ? unwrapExpression(value) : undefined;
  const base: FieldSchema = { name, type: 'unknown', required: true };
  if (!e) return base;
  if (Node.isStringLiteral(e) || Node.isNoSubstitutionTemplateLiteral(e) || Node.isTemplateExpression(e)) return { ...base, type: 'string', ...(Node.isTemplateExpression(e) ? {} : { example: e.getLiteralText() }) };
  if (Node.isNumericLiteral(e)) return { ...base, type: 'number', example: Number(e.getText()) };
  if (e.getText() === 'true' || e.getText() === 'false') return { ...base, type: 'boolean', example: e.getText() === 'true' };
  if (Node.isArrayLiteralExpression(e)) return { ...base, type: 'array', items: 'unknown' };
  if (Node.isObjectLiteralExpression(e)) {
    const fields = depth < MAX_SCHEMA_DEPTH ? objectLiteralFields(ctx, e, depth + 1) : [];
    return { ...base, type: 'object', ...(fields.length ? { fields } : {}) };
  }
  if (Node.isIdentifier(e) || Node.isPropertyAccessExpression(e)) {
    for (const d of ctx.resolve(Node.isPropertyAccessExpression(e) ? e.getNameNode() : e)) {
      if ((Node.isParameterDeclaration(d) || Node.isVariableDeclaration(d) || Node.isPropertyDeclaration(d)) && d.getTypeNode()) return { ...schemaFieldOfType(ctx, name, d.getTypeNode(), true) };
      if (Node.isVariableDeclaration(d) && d.getInitializer() && depth < MAX_SCHEMA_DEPTH && d.getVariableStatement()?.getDeclarationKind() === 'const') return valueField(ctx, name, d.getInitializer(), depth + 1);
    }
  }
  return base;
}

function objectLiteralFields(ctx: FileContext, obj: import('ts-morph').ObjectLiteralExpression, depth: number): FieldSchema[] {
  const out: FieldSchema[] = [];
  for (const p of obj.getProperties()) {
    if (Node.isPropertyAssignment(p)) {
      const n = p.getNameNode();
      const name = Node.isStringLiteral(n) ? n.getLiteralText() : Node.isIdentifier(n) ? n.getText() : undefined;
      if (name) out.push(valueField(ctx, name, p.getInitializer(), depth));
    } else if (Node.isShorthandPropertyAssignment(p)) {
      out.push(valueField(ctx, p.getName(), p.getNameNode(), depth));
    } else if (Node.isSpreadAssignment(p)) {
      const sp = unwrapExpression(p.getExpression());
      if (sp && (Node.isIdentifier(sp) || Node.isPropertyAccessExpression(sp))) {
        for (const d of ctx.resolve(Node.isPropertyAccessExpression(sp) ? sp.getNameNode() : sp)) {
          if ((Node.isParameterDeclaration(d) || Node.isVariableDeclaration(d)) && d.getTypeNode()) out.push(...(schemaFieldsOfType(ctx, d.getTypeNode()) ?? []));
        }
      }
    }
    if (out.length >= MAX_FIELDS_PER_LEVEL) break;
  }
  return out;
}

/** Keys a request payload expression carries: object literal, `JSON.stringify({...})`, or a typed identifier. */
function payloadFields(ctx: FileContext, expr: Node | undefined): FieldSchema[] | undefined {
  let e = expr ? unwrapExpression(expr) : undefined;
  if (!e) return undefined;
  if (Node.isCallExpression(e) && e.getExpression().getText() === 'JSON.stringify' && e.getArguments()[0]) e = unwrapExpression(e.getArguments()[0]);
  if (!e) return undefined;
  if (Node.isObjectLiteralExpression(e)) return objectLiteralFields(ctx, e, 0);
  if (Node.isIdentifier(e) || Node.isPropertyAccessExpression(e)) {
    for (const d of ctx.resolve(Node.isPropertyAccessExpression(e) ? e.getNameNode() : e)) {
      if ((Node.isParameterDeclaration(d) || Node.isVariableDeclaration(d)) && d.getTypeNode()) {
        const f = schemaFieldsOfType(ctx, d.getTypeNode());
        if (f) return f;
      }
      if (Node.isVariableDeclaration(d) && d.getInitializer()) {
        const init = unwrapExpression(d.getInitializer());
        if (init && Node.isObjectLiteralExpression(init)) return objectLiteralFields(ctx, init, 0);
      }
    }
  }
  return undefined;
}

function propertyOf(obj: Node | undefined, name: string): Node | undefined {
  const o = obj ? unwrapExpression(obj) : undefined;
  if (!o || !Node.isObjectLiteralExpression(o)) return undefined;
  const p = o.getProperty(name);
  return p && Node.isPropertyAssignment(p) ? p.getInitializer() : p && Node.isShorthandPropertyAssignment(p) ? p.getNameNode() : undefined;
}

/** `?a=1&b=` written into the URL literal itself. */
function queryKeysOfUrl(url: StaticString): FieldSchema[] {
  const text = url.map((p) => (typeof p === 'string' ? p : '\u0001')).join('');
  const q = text.indexOf('?');
  if (q < 0) return [];
  return [...text.slice(q + 1).matchAll(/(?:^|&)([\w.[\]-]+)=/g)].map((m) => ({ name: m[1], type: 'string' as const, required: false }));
}

function executionOf(ctx: FileContext, call: Node): RequestFact['execution'] {
  const owner = ctx.symbolById.get(ctx.ownerOf(call));
  const declared = owner?.meta.executes;
  if (declared === 'server' || declared === 'client') return declared;
  if (ctx.facts.boundary !== 'unknown') return ctx.facts.boundary;
  if (fileImports(ctx.sf, ['express', '@nestjs/common', 'fastify', 'koa'])) return 'server';
  if (fileImports(ctx.sf, ['react', 'react-dom']) || /\.(tsx|jsx)$/.test(ctx.path)) return 'client';
  return 'unknown';
}

function extract(ctx: FileContext): void {
  const push = (call: CallExpression, library: RequestFact['library'], url: StaticString, method: StaticString | undefined, base?: StaticString, payload?: { body?: Node; params?: Node }) => {
    const bodyFields = payload?.body ? payloadFields(ctx, payload.body) : undefined;
    const paramFields = payload?.params ? payloadFields(ctx, payload.params) : undefined;
    const queryFields = [...queryKeysOfUrl(url), ...(paramFields ?? []).map((f) => ({ ...f, required: false }))];
    ctx.facts.requests.push({
      id: requestId(ctx.path, call.getStartLineNumber(), ctx.column(call)),
      owner: ctx.ownerOf(call),
      line: call.getStartLineNumber(),
      column: ctx.column(call),
      library,
      ...(bodyFields?.length ? { bodyFields } : {}),
      ...(queryFields.length ? { queryFields } : {}),
      method,
      url,
      base,
      execution: executionOf(ctx, call),
      text: call.getText().replace(/\s+/g, ' ').slice(0, 80),
    });
  };

  for (const call of ctx.nodesOf<CallExpression>(SyntaxKind.CallExpression)) {
    const callee = unwrapExpression(call.getExpression());
    if (!callee) continue;
    const args = call.getArguments();

    // --- fetch(url, { method }) ---------------------------------------------------------------
    const isGlobalFetch = Node.isIdentifier(callee) && callee.getText() === 'fetch';
    const isWindowFetch = Node.isPropertyAccessExpression(callee) && callee.getName() === 'fetch' && /^(window|globalThis|self)$/.test(callee.getExpression().getText());
    if ((isGlobalFetch || isWindowFetch) && args[0]) {
      if (Node.isIdentifier(callee)) {
        // a user-defined or foreign function that merely shares the name is not the platform fetch
        if (ctx.resolve(callee).some((d) => !!describeDeclaration(d) && !!ctx.symbolIdOf(d))) continue;
        const ref = moduleRef(callee);
        if (ref && !FETCH_MODULES.includes(ref.module)) continue;
      }
      const first = unwrapExpression(args[0]);
      if (first && Node.isNewExpression(first)) continue; // fetch(new Request(...)) is not analyzed
      const url = ctx.staticValue(args[0], call);
      let method: StaticString | undefined;
      if (args[1]) {
        const { found, init } = propInit(args[1], 'method');
        if (found && init) method = ctx.staticValue(init, call);
        else if (found || hasSpread(args[1]) || !Node.isObjectLiteralExpression(unwrapExpression(args[1])!)) method = [{ hole: 'options', reason: 'expr' }];
      }
      push(call, 'fetch', url, method, undefined, { body: propertyOf(args[1], 'body') });
      continue;
    }

    // --- axios ---------------------------------------------------------------------------------
    if (Node.isPropertyAccessExpression(callee)) {
      const name = callee.getName();
      if (!VERBS.has(name) && name !== 'request') continue;
      const inst = axiosInstance(ctx, callee.getExpression());
      if (!inst.isAxios) continue;
      if (name === 'request') {
        const cfg = args[0];
        const u = propInit(cfg, 'url');
        const m = propInit(cfg, 'method');
        if (!u.init) continue;
        const base = propInit(cfg, 'baseURL').init;
        push(call, 'axios', ctx.staticValue(u.init, call), m.init ? ctx.staticValue(m.init, call) : ['get'], base ? ctx.staticValue(base, call) : inst.base, { body: propertyOf(cfg, 'data'), params: propertyOf(cfg, 'params') });
      } else if (args[0]) {
        const withBody = name === 'post' || name === 'put' || name === 'patch';
        push(call, 'axios', ctx.staticValue(args[0], call), [name], inst.base, { body: withBody ? args[1] : propertyOf(args[1], 'data'), params: propertyOf(withBody ? args[2] : args[1], 'params') });
      }
      continue;
    }
    // axios({ url, method }) / axios(url)
    if (Node.isIdentifier(callee) && args[0] && moduleRef(callee)?.module === 'axios') {
      const first = unwrapExpression(args[0]);
      if (first && Node.isObjectLiteralExpression(first)) {
        const u = propInit(first, 'url');
        const m = propInit(first, 'method');
        const b = propInit(first, 'baseURL');
        if (u.init) push(call, 'axios', ctx.staticValue(u.init, call), m.init ? ctx.staticValue(m.init, call) : ['get'], b.init ? ctx.staticValue(b.init, call) : undefined, { body: propertyOf(first, 'data'), params: propertyOf(first, 'params') });
      } else push(call, 'axios', ctx.staticValue(args[0], call), ['get']);
    }
  }
}

export const httpClientAdapter: FrameworkAdapter = { name: 'http-client', extract };

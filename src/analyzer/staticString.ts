import { Node, type Identifier } from 'ts-morph';
import type { HolePart, StaticString, StrPart } from '../types/analyzer';
import { moduleRef } from './importResolver';
import { substitute } from './pathUtils';
import { redact } from './redact';
import { resolveDeclarations, unwrapExpression } from './symbolResolver';

export interface EvalContext {
  /** Function-like node whose parameters may become `param` holes. */
  ownerFn?: Node;
  /** Called with every declaration read while evaluating, so callers can track file dependencies. */
  touched?: (node: Node) => void;
}

const MAX_DEPTH = 8;

function trunc(text: string): string {
  const t = text.replace(/\s+/g, ' ');
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
}

function hole(node: Node, reason: HolePart['reason'], extra: Partial<HolePart> = {}): StaticString {
  return [{ hole: trunc(node.getText()), reason, ...extra }];
}

/** Compacts adjacent literal pieces. */
function compact(parts: StrPart[]): StaticString {
  const out: StrPart[] = [];
  for (const p of parts) {
    if (typeof p === 'string' && typeof out[out.length - 1] === 'string') out[out.length - 1] = (out[out.length - 1] as string) + p;
    else if (typeof p !== 'string' || p !== '') out.push(p);
  }
  return out;
}

function envName(node: Node): string | undefined {
  const text = node.getText().replace(/\s+/g, '');
  let m = /^process\.env\.([A-Za-z0-9_]+)$/.exec(text) ?? /^process\.env\[['"`]([A-Za-z0-9_]+)['"`]\]$/.exec(text);
  if (m) return m[1];
  m = /^import\.meta\.env\.([A-Za-z0-9_]+)$/.exec(text) ?? /^import\.meta\.env\[['"`]([A-Za-z0-9_]+)['"`]\]$/.exec(text);
  return m ? m[1] : undefined;
}

export function isStringLike(node: Node | undefined): boolean {
  const n = unwrapExpression(node);
  return !!n && (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n) || Node.isTemplateExpression(n) || (Node.isBinaryExpression(n) && n.getOperatorToken().getText() === '+'));
}

/**
 * Evaluates an expression into literal text plus holes. Never executes code: only literals, template
 * literals, `+`, `const` bindings, enum members, constant object properties and env lookups are followed.
 */
export function evalString(node: Node | undefined, ctx: EvalContext = {}, depth = 0): StaticString {
  if (!node) return [];
  const n = unwrapExpression(node);
  if (!n) return [];
  if (depth > MAX_DEPTH) return hole(n, 'expr');

  if (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n)) return [redact(n.getLiteralText())];
  if (Node.isTemplateExpression(n)) {
    const parts: StrPart[] = [redact(n.getHead().getLiteralText())];
    for (const span of n.getTemplateSpans()) {
      parts.push(...evalString(span.getExpression(), ctx, depth + 1));
      parts.push(redact(span.getLiteral().getLiteralText()));
    }
    return compact(parts);
  }
  if (Node.isBinaryExpression(n)) {
    const op = n.getOperatorToken().getText();
    if (op === '+') return compact([...evalString(n.getLeft(), ctx, depth + 1), ...evalString(n.getRight(), ctx, depth + 1)]);
    if (op === '||' || op === '??') {
      const left = evalString(n.getLeft(), ctx, depth + 1);
      const first = left[0];
      if (left.length === 1 && typeof first !== 'string' && first.reason === 'env') {
        return [{ ...first, fallback: evalString(n.getRight(), ctx, depth + 1) }];
      }
      return left.length && left.every((p) => typeof p === 'string') ? left : hole(n, 'expr');
    }
    return hole(n, 'expr');
  }
  if (Node.isConditionalExpression(n)) {
    // cond ? `?${qs}` : ''  — an optional query string, not a path component
    const t = evalString(n.getWhenTrue(), ctx, depth + 1);
    const f = evalString(n.getWhenFalse(), ctx, depth + 1);
    const q = (x: StaticString) => typeof x[0] === 'string' && x[0].startsWith('?');
    const empty = (x: StaticString) => x.length === 0 || (x.length === 1 && x[0] === '');
    if ((empty(f) && q(t)) || (empty(t) && q(f))) return ['?'];
    return hole(n, 'expr');
  }
  if (Node.isCallExpression(n)) {
    const viaMember = evalMemberCall(n, ctx, depth);
    if (viaMember) return viaMember;
    const callee = n.getExpression().getText();
    if (/^(String|encodeURIComponent|encodeURI|String\.raw)$/.test(callee) && n.getArguments().length === 1) {
      return evalString(n.getArguments()[0], ctx, depth + 1);
    }
    return inlineCall(n, ctx, depth) ?? hole(n, 'expr');
  }
  const env = envName(n);
  if (env) return hole(n, 'env', { env });

  if (Node.isIdentifier(n) || Node.isPropertyAccessExpression(n) || Node.isElementAccessExpression(n)) {
    if (Node.isElementAccessExpression(n)) return hole(n, 'expr');
    const target: Identifier | Node = Node.isPropertyAccessExpression(n) ? n.getNameNode() : n;
    const decls = resolveDeclarations(target);
    for (const d of decls) {
      ctx.touched?.(d);
      if (Node.isParameterDeclaration(d)) {
        const fn = d.getParent();
        if (ctx.ownerFn && fn === ctx.ownerFn && Node.isIdentifier(d.getNameNode())) {
          return hole(n, 'param', { param: (fn as unknown as { getParameters(): Node[] }).getParameters().indexOf(d) });
        }
        return hole(n, 'expr');
      }
      if (Node.isVariableDeclaration(d)) {
        const isConst = d.getVariableStatement()?.getDeclarationKind() === 'const';
        const init = d.getInitializer();
        if (isConst && init) return evalString(init, ctx, depth + 1);
        return hole(n, 'expr');
      }
      if (Node.isPropertyAssignment(d) || Node.isEnumMember(d) || Node.isPropertyDeclaration(d)) {
        const init = d.getInitializer();
        if (init) return evalString(init, ctx, depth + 1);
      }
    }
    return hole(n, 'expr');
  }
  return hole(n, 'expr');
}


const SLASH_REGEX = /^\^?\\\/[+*]?\$?$/; // /\/+$/, /\/$/, /^\//

/** `base.replace(/\/+$/, '')`, `.trim()`, `.toString()` and Nest `configService.get('X')`. */
function evalMemberCall(call: import('ts-morph').CallExpression, ctx: EvalContext, depth: number): StaticString | undefined {
  const callee = unwrapExpression(call.getExpression());
  if (!callee || !Node.isPropertyAccessExpression(callee)) return undefined;
  const name = callee.getName();
  const args = call.getArguments();
  if (name === 'trim' || name === 'trimEnd' || name === 'trimStart' || name === 'toString') return evalString(callee.getExpression(), ctx, depth + 1);
  if (name === 'replace' && args.length === 2) {
    const [re, rep] = [unwrapExpression(args[0]), unwrapExpression(args[1])];
    const slashOnly = !!re && Node.isRegularExpressionLiteral(re) && SLASH_REGEX.test(re.getText().replace(/^\/(.*)\/[a-z]*$/, '$1'));
    if (slashOnly && rep && Node.isStringLiteral(rep) && rep.getLiteralText() === '') return evalString(callee.getExpression(), ctx, depth + 1);
    return undefined;
  }
  if ((name === 'get' || name === 'getOrThrow') && args[0] && isNestConfigService(callee.getExpression())) {
    const key = unwrapExpression(args[0]);
    if (!key || !(Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key))) return undefined;
    const env = key.getLiteralText();
    const fallback = args[1] ? evalString(args[1], ctx, depth + 1) : undefined;
    return [{ hole: `configService.get('${env}')`, reason: 'env', env, ...(fallback ? { fallback } : {}) }];
  }
  return undefined;
}

/** Receiver declared (property or parameter) with the type `ConfigService` imported from `@nestjs/config`. */
function isNestConfigService(recv: Node): boolean {
  const e = unwrapExpression(recv);
  if (!e || !Node.isPropertyAccessExpression(e)) return false;
  for (const d of resolveDeclarations(e.getNameNode())) {
    if (Node.isParameterDeclaration(d) || Node.isPropertyDeclaration(d)) {
      const t = d.getTypeNode();
      if (t && Node.isTypeReference(t) && t.getTypeName().getText() === 'ConfigService' && moduleRef(t.getTypeName())?.module === '@nestjs/config') return true;
    }
  }
  return false;
}

/**
 * URL-builder helpers (`buildUrl(base, path)`): when the callee is a workspace function whose body is a single
 * returned expression, evaluate that expression with its parameters as holes and substitute the call's arguments.
 */
function inlineCall(call: import('ts-morph').CallExpression, ctx: EvalContext, depth: number): StaticString | undefined {
  if (depth > 5) return undefined;
  const callee = unwrapExpression(call.getExpression());
  if (!callee || !(Node.isIdentifier(callee) || Node.isPropertyAccessExpression(callee))) return undefined;
  for (const d of resolveDeclarations(Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee)) {
    let fn: Node | undefined;
    if (Node.isFunctionDeclaration(d) || Node.isMethodDeclaration(d)) fn = d;
    else if (Node.isVariableDeclaration(d)) {
      const init = unwrapExpression(d.getInitializer());
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) fn = init;
    }
    if (!fn || !(Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) continue;
    ctx.touched?.(d);
    let expr: Node | undefined;
    const body = fn.getBody();
    if (body && !Node.isBlock(body)) expr = body;
    else if (body && Node.isBlock(body)) {
      const stmts = body.getStatements();
      if (stmts.length === 1 && Node.isReturnStatement(stmts[0])) expr = stmts[0].getExpression();
    }
    if (!expr) continue;
    const parts = evalString(expr, { ownerFn: fn, touched: ctx.touched }, depth + 1);
    const args = call.getArguments().map((a) => evalString(a, ctx, depth + 1));
    return substitute(parts, args);
  }
  return undefined;
}

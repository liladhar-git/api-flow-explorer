import { Node, type CallExpression } from 'ts-morph';
import { MAX_FIELDS_PER_LEVEL, MAX_SCHEMA_DEPTH, type FieldSchema } from '../../../types/requestSchema';
import type { FileContext } from '../../fileContext';
import { moduleRef } from '../../importResolver';
import { unwrapExpression } from '../../symbolResolver';

const PASS_THROUGH = new Set(['strict', 'passthrough', 'strip', 'refine', 'superRefine', 'transform', 'describe', 'brand', 'readonly', 'pipe', 'catchall']);
const NON_REQUIRING = new Set(['optional', 'nullish', 'default', 'catch']);
const SCALAR_NOOP = new Set(['min', 'max', 'length', 'trim', 'toLowerCase', 'toUpperCase', 'int', 'positive', 'negative', 'nonnegative', 'nonpositive', 'gt', 'gte', 'lt', 'lte', 'regex', 'nonempty', 'multipleOf', 'finite', 'safe', 'startsWith', 'endsWith', 'includes', 'datetime', 'nullable']);

const isZod = (ctx: FileContext, recv: Node): boolean => {
  const r = moduleRef(recv);
  if (r?.module === 'zod' || r?.module.startsWith('zod/')) return true;
  // z.coerce.number()
  const e = unwrapExpression(recv);
  return !!e && Node.isPropertyAccessExpression(e) && e.getName() === 'coerce' && isZod(ctx, e.getExpression());
};

/** Follows an identifier / member access to the expression it was initialized with. */
function initializerOf(ctx: FileContext, expr: Node, depth = 0): Node {
  const e = unwrapExpression(expr)!;
  if (depth > 4 || !(Node.isIdentifier(e) || Node.isPropertyAccessExpression(e))) return e;
  for (const d of ctx.resolve(Node.isPropertyAccessExpression(e) ? e.getNameNode() : e)) {
    if (Node.isVariableDeclaration(d) && d.getInitializer()) return initializerOf(ctx, d.getInitializer()!, depth + 1);
  }
  return e;
}

interface Peeled {
  root?: CallExpression;
  required: boolean;
  example?: string;
  partial: boolean;
  extend: Node[];
}

/** Strips `.optional()`, `.email()`, `.min(1)` … off a schema chain and returns the root `z.xxx(...)` call. */
function peel(ctx: FileContext, expr: Node): Peeled {
  const out: Peeled = { required: true, partial: false, extend: [] };
  let cur: Node = initializerOf(ctx, expr);
  for (let i = 0; i < 24; i++) {
    cur = unwrapExpression(cur)!;
    if (!Node.isCallExpression(cur)) break;
    const callee = unwrapExpression(cur.getExpression());
    if (!callee || !Node.isPropertyAccessExpression(callee)) break;
    const m = callee.getName();
    const recv = callee.getExpression();
    if (isZod(ctx, recv)) {
      out.root = cur;
      return out;
    }
    if (NON_REQUIRING.has(m)) out.required = false;
    else if (m === 'email') out.example = 'name@example.com';
    else if (m === 'url') out.example = 'https://example.com';
    else if (m === 'uuid') out.example = '00000000-0000-4000-8000-000000000000';
    else if (m === 'partial' || m === 'deepPartial') out.partial = true;
    else if (m === 'extend' || m === 'merge') out.extend.push(...cur.getArguments());
    else if (!PASS_THROUGH.has(m) && !SCALAR_NOOP.has(m) && !['pick', 'omit', 'required', 'shape'].includes(m)) break;
    cur = initializerOf(ctx, recv);
  }
  return out;
}

function objectFields(ctx: FileContext, objectCall: CallExpression, extra: Node[], partial: boolean, depth: number): FieldSchema[] {
  const out: FieldSchema[] = [];
  const read = (obj: Node | undefined) => {
    const o = obj ? unwrapExpression(obj) : undefined;
    if (!o || !Node.isObjectLiteralExpression(o)) return;
    for (const p of o.getProperties()) {
      if (!Node.isPropertyAssignment(p) && !Node.isShorthandPropertyAssignment(p)) continue;
      const nameNode = p.getNameNode();
      const name = Node.isStringLiteral(nameNode) ? nameNode.getLiteralText() : nameNode.getText();
      const init = Node.isPropertyAssignment(p) ? p.getInitializer() : p.getNameNode();
      if (!init) continue;
      const f = zodField(ctx, name, init, depth + 1);
      out.splice(0, out.length, ...out.filter((x) => x.name !== name), partial ? { ...f, required: false } : f);
      if (out.length >= MAX_FIELDS_PER_LEVEL) return;
    }
  };
  read(objectCall.getArguments()[0]);
  for (const a of extra) {
    const inner = zodObjectFields(ctx, a, depth);
    if (inner) for (const f of inner) out.splice(0, out.length, ...out.filter((x) => x.name !== f.name), f);
    else read(a); // `.extend({ more: z.string() })`
  }
  return out;
}

function zodField(ctx: FileContext, name: string, expr: Node, depth: number): FieldSchema {
  const p = peel(ctx, expr);
  const call = p.root;
  if (!call) return { name, type: 'unknown', required: p.required };
  const kind = (unwrapExpression(call.getExpression()) as import('ts-morph').PropertyAccessExpression).getName();
  const args = call.getArguments();
  const base: FieldSchema = { name, type: 'unknown', required: p.required, ...(p.example ? { example: p.example } : {}) };
  switch (kind) {
    case 'string':
    case 'date':
      return { ...base, type: 'string' };
    case 'number':
    case 'bigint':
      return { ...base, type: 'number' };
    case 'boolean':
      return { ...base, type: 'boolean' };
    case 'enum': {
      const a = args[0] ? unwrapExpression(args[0]) : undefined;
      const arr = a && Node.isArrayLiteralExpression(a) ? a : undefined;
      const values = arr ? arr.getElements().flatMap((e): string[] => (Node.isStringLiteral(e) ? [e.getLiteralText()] : [])) : [];
      return { ...base, type: 'string', enumValues: values };
    }
    case 'nativeEnum': {
      const a = args[0] ? unwrapExpression(args[0]) : undefined;
      const en = a && (Node.isIdentifier(a) || Node.isPropertyAccessExpression(a)) ? ctx.resolve(Node.isPropertyAccessExpression(a) ? a.getNameNode() : a).find((d) => Node.isEnumDeclaration(d)) : undefined;
      const values = en && Node.isEnumDeclaration(en) ? en.getMembers().map((m) => m.getValue()).filter((v): v is string | number => v !== undefined) : [];
      return { ...base, type: typeof values[0] === 'number' ? 'number' : 'string', enumValues: values };
    }
    case 'literal': {
      const a = args[0] ? unwrapExpression(args[0]) : undefined;
      if (a && (Node.isStringLiteral(a) || Node.isNoSubstitutionTemplateLiteral(a))) return { ...base, type: 'string', example: a.getLiteralText() };
      if (a && Node.isNumericLiteral(a)) return { ...base, type: 'number', example: Number(a.getText()) };
      return base;
    }
    case 'array': {
      const inner = args[0] ? zodField(ctx, name, args[0], depth + 1) : undefined;
      return { ...base, type: 'array', items: inner?.type ?? 'unknown', ...(inner?.type === 'object' && inner.fields?.length ? { fields: inner.fields } : {}) };
    }
    case 'object':
    case 'strictObject':
    case 'looseObject': {
      const fields = depth < MAX_SCHEMA_DEPTH ? objectFields(ctx, call, p.extend, p.partial, depth) : [];
      return { ...base, type: 'object', ...(fields.length ? { fields } : {}) };
    }
    case 'record':
    case 'map':
      return { ...base, type: 'object' };
    default:
      return base;
  }
}

/** Fields of `z.object({...})` (directly, via a const, or through `.extend()/.partial()/.strict()`); undefined if not a zod object. */
export function zodObjectFields(ctx: FileContext, expr: Node, depth = 0): FieldSchema[] | undefined {
  const p = peel(ctx, expr);
  const call = p.root;
  if (!call) return undefined;
  const kind = (unwrapExpression(call.getExpression()) as import('ts-morph').PropertyAccessExpression).getName();
  if (kind !== 'object' && kind !== 'strictObject' && kind !== 'looseObject') return undefined;
  const fields = objectFields(ctx, call, p.extend, p.partial, depth);
  return fields.length ? fields : undefined;
}

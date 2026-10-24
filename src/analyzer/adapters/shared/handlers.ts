import { Node } from 'ts-morph';
import type { HandlerRef } from '../../../types/analyzer';
import type { FileContext } from '../../fileContext';
import { unwrapExpression } from '../../symbolResolver';

const WRAPPER_CALLEE = /handler|async|catch|wrap|safe|tryCatch|^with[A-Z]|^use[A-Z]/i;

export const isFunctionNode = (n: Node | undefined): n is import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression =>
  !!n && (Node.isArrowFunction(n) || Node.isFunctionExpression(n));

/**
 * Turns an argument expression (route handler, middleware, guard...) into a reference to a workspace symbol.
 * Inline functions become their own symbols so calls inside them are attributed correctly. Unresolvable
 * expressions keep their source text so the caller can report them.
 */
export function handlerRef(ctx: FileContext, expr: Node, anonLabel: string): HandlerRef {
  const line = expr.getStartLineNumber();
  const text = expr.getText().replace(/\s+/g, ' ').slice(0, 80);
  const e = unwrapExpression(expr);
  if (!e) return { text, line };

  if (isFunctionNode(e)) {
    const known = ctx.ownerByNode.get(e); // already a named symbol (e.g. `export default () => {}`)
    if (known) return { id: known, text: 'inline function', line };
    const id = ctx.declareAnonymous(e, `${anonLabel}@L${e.getStartLineNumber()}`, 'function', { handler: true }, anonLabel);
    return { id, text: 'inline function', line };
  }

  if (Node.isIdentifier(e) || Node.isPropertyAccessExpression(e)) {
    const target = Node.isPropertyAccessExpression(e) ? e.getNameNode() : e;
    for (const d of ctx.resolve(target)) {
      const sid = ctx.symbolIdOf(d);
      if (sid) return { id: sid.id, text, line };
    }
    return { text, line, note: 'could not resolve to a workspace declaration' };
  }

  if (Node.isCallExpression(e)) {
    // asyncHandler(fn) / withAuth(fn): the wrapped function is what actually handles the request
    const callee = e.getExpression();
    const calleeName = Node.isIdentifier(callee) ? callee.getText() : Node.isPropertyAccessExpression(callee) ? callee.getName() : '';
    for (const arg of e.getArguments()) {
      const a = unwrapExpression(arg);
      if (a && WRAPPER_CALLEE.test(calleeName) && (isFunctionNode(a) || Node.isIdentifier(a) || Node.isPropertyAccessExpression(a))) {
        const inner = handlerRef(ctx, a, anonLabel);
        if (inner.id) return { ...inner, text, note: `wrapped by ${calleeName}()` };
      }
    }
    // middleware factory: requireRole('admin') → the factory is the closest resolvable symbol
    const target = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
    if (Node.isIdentifier(target)) {
      for (const d of ctx.resolve(target)) {
        const sid = ctx.symbolIdOf(d);
        if (sid) return { id: sid.id, text, line, note: `factory call ${calleeName}(...)` };
      }
    }
  }
  return { text, line, note: 'expression is not statically resolvable' };
}

/** Flattens `[a, b]` arguments; other expressions pass through. */
export function flattenArgs(args: Node[]): Node[] {
  const out: Node[] = [];
  for (const a of args) {
    const e = unwrapExpression(a);
    if (e && Node.isArrayLiteralExpression(e)) out.push(...flattenArgs(e.getElements()));
    else out.push(a);
  }
  return out;
}

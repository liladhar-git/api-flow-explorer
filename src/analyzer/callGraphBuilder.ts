import { Node, SyntaxKind, type JsxOpeningElement, type JsxSelfClosingElement } from 'ts-morph';
import type { CallFact, StaticString } from '../types/analyzer';
import type { FileContext } from './fileContext';
import { describeDeclaration, unwrapExpression } from './symbolResolver';

const MAX_TARGETS = 4;

/**
 * Statically resolvable calls, `new` expressions and JSX renders. A call fact says "the source contains a call to X",
 * never "X executes": branches, dead code and conditional paths are not evaluated.
 */
export function buildCallFacts(ctx: FileContext): void {
  const seen = new Set<string>();
  const push = (fact: CallFact) => {
    const key = `${fact.from}|${fact.to}|${fact.callKind}|${fact.line}`;
    if (seen.has(key)) return;
    seen.add(key);
    ctx.facts.calls.push(fact);
  };

  const handle = (expr: Node, node: Node, callKind: 'call' | 'new', args: Node[]) => {
    if (Node.isSuperExpression(expr)) return;
    const target = Node.isPropertyAccessExpression(expr) ? expr.getNameNode() : expr;
    if (!(Node.isIdentifier(target) || Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target))) return;
    const decls = Node.isElementAccessExpression(target) ? [] : ctx.resolve(target);
    const ids = new Map<string, { qualified: string; path: string }>();
    for (const d of decls) {
      const sid = ctx.symbolIdOf(d);
      if (sid) ids.set(sid.id, sid);
    }
    if (ids.size === 0) {
      if (decls.length === 0) ctx.facts.unresolvedCalls++;
      return;
    }
    const from = ctx.ownerOf(node);
    const ambiguous = ids.size > 1;
    // keep arguments that carry string evidence (literals, constants) or pass a wrapper's own parameter along
    const argStrings: (StaticString | null)[] = args.slice(0, 4).map((a) => {
      const e = unwrapExpression(a);
      if (!e || !(Node.isStringLiteral(e) || Node.isNoSubstitutionTemplateLiteral(e) || Node.isTemplateExpression(e) || Node.isBinaryExpression(e) || Node.isIdentifier(e) || Node.isPropertyAccessExpression(e))) return null;
      const v = ctx.staticValue(a, node);
      const informative = v.some((p) => typeof p === 'string' || p.reason === 'param');
      return informative ? v : null;
    });
    const hasArgs = argStrings.some((a) => a !== null);
    let n = 0;
    for (const [to, info] of ids) {
      if (++n > MAX_TARGETS) break;
      if (to === from) continue; // direct recursion adds no information
      push({
        from,
        to,
        line: node.getStartLineNumber(),
        callKind,
        confidence: ambiguous ? 'medium' : 'high',
        resolution: ambiguous ? 'inferred' : 'resolved',
        explanation: ambiguous
          ? `${callKind === 'new' ? 'new ' : ''}${info.qualified}() is one of ${ids.size} declarations the call may bind to`
          : `${callKind === 'new' ? 'instantiates' : 'calls'} ${info.qualified} (${info.path})`,
        args: hasArgs ? argStrings : undefined,
      });
    }
  };

  for (const call of ctx.nodesOf<import('ts-morph').CallExpression>(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKind() === SyntaxKind.ImportKeyword) continue; // dynamic import; reported elsewhere
    handle(expr, call, 'call', call.getArguments());
  }
  for (const nw of ctx.nodesOf<import('ts-morph').NewExpression>(SyntaxKind.NewExpression)) {
    handle(nw.getExpression(), nw, 'new', nw.getArguments());
  }

  const jsx = [
    ...ctx.nodesOf<JsxOpeningElement>(SyntaxKind.JsxOpeningElement),
    ...ctx.nodesOf<JsxSelfClosingElement>(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const el of jsx) {
    const tag = el.getTagNameNode();
    const first = tag.getText()[0];
    if (!first || first !== first.toUpperCase() || first === '_') continue; // intrinsic DOM element
    const target = Node.isPropertyAccessExpression(tag) ? tag.getNameNode() : tag;
    const decls = ctx.resolve(target);
    for (const d of decls) {
      const sid = ctx.symbolIdOf(d);
      if (!sid || !describeDeclaration(d)) continue;
      const from = ctx.ownerOf(el);
      if (from === sid.id) continue;
      push({
        from,
        to: sid.id,
        line: el.getStartLineNumber(),
        callKind: 'render',
        confidence: 'high',
        resolution: 'resolved',
        explanation: `renders <${tag.getText()}> (${sid.path})`,
      });
      break;
    }
  }
}

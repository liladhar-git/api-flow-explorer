import { Node } from 'ts-morph';

const MAX = 240;

/** First paragraph of the JSDoc comment attached to a declaration (functions, methods, classes, `const f = () =>`). */
export function docSummary(node: Node): string | undefined {
  let target: Node | undefined = node;
  if (Node.isVariableDeclaration(node)) target = node.getVariableStatement();
  if (!target || !Node.isJSDocable(target)) return undefined;
  const docs = target.getJsDocs();
  const last = docs[docs.length - 1];
  const text = last?.getDescription().trim();
  if (!text) return undefined;
  const first = text.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  return first.length > MAX ? first.slice(0, MAX - 1) + '…' : first || undefined;
}

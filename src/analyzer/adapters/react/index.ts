import { Node, SyntaxKind } from 'ts-morph';
import type { FileContext } from '../../fileContext';
import type { FrameworkAdapter } from '../shared/adapter';

/**
 * React: components are symbols that contain JSX and are named like components; hooks are `use*` functions.
 * Render relationships come from the shared JSX pass in callGraphBuilder; this adapter only classifies symbols.
 */
function extract(ctx: FileContext): void {
  const jsx = [
    ...ctx.nodesOf(SyntaxKind.JsxOpeningElement),
    ...ctx.nodesOf(SyntaxKind.JsxSelfClosingElement),
    ...ctx.nodesOf(SyntaxKind.JsxFragment),
  ];
  const withJsx = new Set<string>();
  for (const el of jsx) {
    // a class component renders from its `render` method; credit the class
    const owner = ctx.ownerNodeOf(el);
    if (!owner) continue;
    const id = ctx.ownerByNode.get(owner)!;
    const sym = ctx.symbolById.get(id);
    if (!sym) continue;
    if (sym.qualified.endsWith('.render') && Node.isMethodDeclaration(owner)) {
      const cls = owner.getParent();
      if (Node.isClassDeclaration(cls) && cls.getName()) withJsx.add(id.slice(0, id.lastIndexOf('.')));
    } else withJsx.add(id);
  }

  for (const sym of ctx.facts.symbols) {
    if (sym.kind !== 'function') continue; // already classified by another adapter
    const type = sym.meta.symbolType;
    if (withJsx.has(sym.id) && /^[A-Z]/.test(sym.name) && !sym.qualified.includes('.') && (type === 'function' || type === 'arrow' || type === 'class')) {
      ctx.classify(sym.id, 'frontend-component', { framework: 'react' });
    } else if (/^use[A-Z0-9]/.test(sym.name) && !sym.qualified.includes('.')) {
      ctx.classify(sym.id, 'function', { hook: true });
    }
  }
}

export const reactAdapter: FrameworkAdapter = { name: 'react', extract };

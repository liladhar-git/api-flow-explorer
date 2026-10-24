import { Node, SyntaxKind, type Identifier, type SourceFile } from 'ts-morph';
import { unwrapExpression } from './symbolResolver';

export interface ModuleRef {
  module: string;
  /** Imported member ('Router'); undefined for the module itself / default export. */
  member?: string;
}

function requireSpecifier(init: Node | undefined): string | undefined {
  const e = unwrapExpression(init);
  if (e && Node.isCallExpression(e)) {
    const callee = e.getExpression();
    const arg = e.getArguments()[0];
    if (Node.isIdentifier(callee) && callee.getText() === 'require' && arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) {
      return arg.getLiteralText();
    }
  }
  return undefined;
}

/** Which package an identifier was imported from, using syntax only (works without installed @types). */
export function moduleOfIdentifier(id: Identifier): ModuleRef | undefined {
  let decls: Node[];
  try {
    decls = id.getSymbol()?.getDeclarations() ?? [];
  } catch {
    return undefined;
  }
  for (const d of decls) {
    if (Node.isImportSpecifier(d)) {
      return { module: d.getImportDeclaration().getModuleSpecifierValue(), member: d.getName() };
    }
    if (Node.isImportClause(d) || Node.isNamespaceImport(d)) {
      const imp = d.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
      if (imp) return { module: imp.getModuleSpecifierValue() };
    }
    if (Node.isVariableDeclaration(d)) {
      const spec = requireSpecifier(d.getInitializer());
      if (spec) return { module: spec };
    }
    if (Node.isBindingElement(d)) {
      const vd = d.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      const spec = vd ? requireSpecifier(vd.getInitializer()) : undefined;
      if (spec) return { module: spec, member: (d.getPropertyNameNode() ?? d.getNameNode()).getText() };
    }
  }
  return undefined;
}

/** `express.Router` / `{ Router }` / `mongoose` → { module, member }. */
export function moduleRef(expr: Node | undefined): ModuleRef | undefined {
  const e = unwrapExpression(expr);
  if (!e) return undefined;
  if (Node.isIdentifier(e)) return moduleOfIdentifier(e);
  if (Node.isPropertyAccessExpression(e)) {
    const base = moduleRef(e.getExpression());
    if (base && base.member === undefined) return { module: base.module, member: e.getName() };
  }
  return undefined;
}

/** True if the file imports (or requires) any of the given packages. */
export function fileImports(sf: SourceFile, modules: string[]): boolean {
  for (const imp of sf.getImportDeclarations()) {
    const v = imp.getModuleSpecifierValue();
    if (modules.some((m) => v === m || v.startsWith(m + '/'))) return true;
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const spec = requireSpecifier(call);
    if (spec && modules.some((m) => spec === m || spec.startsWith(m + '/'))) return true;
  }
  return false;
}

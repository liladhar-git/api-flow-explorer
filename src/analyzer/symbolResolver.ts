import { Node } from 'ts-morph';

export interface DeclDescription {
  name: string;
  qualified: string;
  symbolType: 'function' | 'class' | 'method' | 'arrow' | 'object-method' | 'constructor';
  /** Function-like node (or class) that owns calls made in its body. */
  owner: Node;
}

const WRAPPER_NAME = /^(memo|forwardRef|useCallback|observer|asyncHandler|catchAsync|catchErrors|wrapAsync|tryCatch|handler|createHandler)$|handler|async|catch|wrap|^with[A-Z]/i;

function calleeName(call: Node): string {
  if (!Node.isCallExpression(call)) return '';
  const e = call.getExpression();
  if (Node.isIdentifier(e)) return e.getText();
  if (Node.isPropertyAccessExpression(e)) return e.getName();
  return '';
}

/** Strips parentheses/`as`/`satisfies`/`!` wrappers. */
export function unwrapExpression(node: Node | undefined): Node | undefined {
  let n = node;
  while (n && (Node.isParenthesizedExpression(n) || Node.isAsExpression(n) || Node.isNonNullExpression(n) || Node.isSatisfiesExpression(n) || Node.isTypeAssertion(n))) {
    n = n.getExpression();
  }
  return n;
}

/** The function-like body a variable initializer defines, looking through common wrapper calls (memo, asyncHandler, ...). */
export function functionOfInitializer(init: Node | undefined, variableName: string): Node | undefined {
  const n = unwrapExpression(init);
  if (!n) return undefined;
  if (Node.isArrowFunction(n) || Node.isFunctionExpression(n) || Node.isClassExpression(n)) return n;
  if (Node.isCallExpression(n)) {
    const name = calleeName(n);
    const capitalized = /^[A-Z]/.test(variableName);
    if (/^use[A-Z]/.test(name) && name !== 'useCallback') return undefined;
    if (!capitalized && !WRAPPER_NAME.test(name)) return undefined;
    for (const arg of n.getArguments()) {
      const a = unwrapExpression(arg);
      if (a && (Node.isArrowFunction(a) || Node.isFunctionExpression(a))) return a;
      // memo(forwardRef((props, ref) => ...))
      if (a && Node.isCallExpression(a)) {
        const inner = functionOfInitializer(a, variableName);
        if (inner) return inner;
      }
    }
  }
  return undefined;
}

function objectNameOf(obj: Node): string | undefined {
  const parent = obj.getParent();
  if (parent && Node.isVariableDeclaration(parent)) return parent.getName();
  const inner = unwrapExpression(obj);
  void inner;
  if (parent && (Node.isAsExpression(parent) || Node.isSatisfiesExpression(parent) || Node.isParenthesizedExpression(parent))) return objectNameOf(parent);
  if (parent && Node.isExportAssignment(parent)) return 'default';
  return undefined;
}

function memberName(node: Node): string | undefined {
  if (Node.isConstructorDeclaration(node)) return 'constructor';
  const named = node as unknown as { getName?: () => string; getNameNode?: () => Node };
  const nameNode = named.getNameNode?.();
  if (nameNode && Node.isComputedPropertyName(nameNode)) return undefined;
  return named.getName?.();
}

/**
 * Names a declaration the same way regardless of which file asks, which is what makes symbol IDs
 * stable and lets cross-file resolution produce the same ID the declaring file emitted.
 */
export function describeDeclaration(decl: Node): DeclDescription | undefined {
  if (Node.isFunctionDeclaration(decl)) {
    const name = decl.getName() ?? (decl.isDefaultExport() ? 'default' : undefined);
    return name ? { name, qualified: name, symbolType: 'function', owner: decl } : undefined;
  }
  if (Node.isClassDeclaration(decl)) {
    const name = decl.getName() ?? (decl.isDefaultExport() ? 'default' : undefined);
    return name ? { name, qualified: name, symbolType: 'class', owner: decl } : undefined;
  }
  if (Node.isVariableDeclaration(decl)) {
    const nameNode = decl.getNameNode();
    if (!Node.isIdentifier(nameNode)) return undefined;
    const name = nameNode.getText();
    const fn = functionOfInitializer(decl.getInitializer(), name);
    if (!fn) return undefined;
    if (Node.isClassExpression(fn)) return { name, qualified: name, symbolType: 'class', owner: fn };
    return { name, qualified: name, symbolType: 'arrow', owner: fn };
  }
  if (Node.isMethodDeclaration(decl) || Node.isGetAccessorDeclaration(decl) || Node.isSetAccessorDeclaration(decl) || Node.isConstructorDeclaration(decl)) {
    const name = memberName(decl);
    const parent = decl.getParent();
    if (!name || !parent) return undefined;
    if (Node.isClassDeclaration(parent) || Node.isClassExpression(parent)) {
      const cls = parent.getName() ?? (Node.isClassDeclaration(parent) && parent.isDefaultExport() ? 'default' : objectNameOf(parent) ?? undefined);
      if (!cls) return undefined;
      return { name, qualified: `${cls}.${name}`, symbolType: Node.isConstructorDeclaration(decl) ? 'constructor' : 'method', owner: decl };
    }
    if (Node.isObjectLiteralExpression(parent)) {
      const obj = objectNameOf(parent);
      if (!obj) return undefined;
      return { name, qualified: `${obj}.${name}`, symbolType: 'object-method', owner: decl };
    }
    return undefined;
  }
  if (Node.isPropertyDeclaration(decl)) {
    const parent = decl.getParent();
    const init = unwrapExpression(decl.getInitializer());
    if (!init || !(Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return undefined;
    if (!(Node.isClassDeclaration(parent) || Node.isClassExpression(parent))) return undefined;
    const cls = parent.getName();
    const name = memberName(decl);
    if (!cls || !name) return undefined;
    return { name, qualified: `${cls}.${name}`, symbolType: 'method', owner: init };
  }
  if (Node.isPropertyAssignment(decl)) {
    const parent = decl.getParent();
    const init = unwrapExpression(decl.getInitializer());
    if (!init || !(Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return undefined;
    if (!Node.isObjectLiteralExpression(parent)) return undefined;
    const obj = objectNameOf(parent);
    const name = memberName(decl);
    if (!obj || !name) return undefined;
    return { name, qualified: `${obj}.${name}`, symbolType: 'object-method', owner: init };
  }
  if (Node.isExportAssignment(decl) && !decl.isExportEquals()) {
    const expr = unwrapExpression(decl.getExpression());
    if (expr && (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr))) return { name: 'default', qualified: 'default', symbolType: 'arrow', owner: expr };
    if (expr && Node.isClassExpression(expr)) return { name: 'default', qualified: 'default', symbolType: 'class', owner: expr };
  }
  return undefined;
}

/**
 * Declarations a node refers to, following import/export aliases. Returns [] when the symbol is unknown,
 * which callers must treat as "unresolved" rather than guessing.
 */
export function resolveDeclarations(node: Node): Node[] {
  let sym;
  try {
    sym = node.getSymbol();
    if (!sym) return [];
    if (sym.isAlias()) {
      const aliased = sym.getAliasedSymbol();
      if (aliased) sym = aliased;
    }
  } catch {
    return [];
  }
  let decls: Node[] = [];
  try {
    decls = sym.getDeclarations();
  } catch {
    return [];
  }
  return decls.flatMap((d) => followDeclaration(d, 0));
}

/** `export default router` and `const alias = other` hops: land on the declaration that holds the real definition. */
export function followDeclaration(decl: Node, depth: number): Node[] {
  if (depth > 6) return [decl];
  if (Node.isExportAssignment(decl)) {
    const expr = unwrapExpression(decl.getExpression());
    if (expr && Node.isIdentifier(expr)) {
      const next = resolveDeclarations(expr);
      return next.length ? next : [decl];
    }
    return [decl];
  }
  if (Node.isExportSpecifier(decl) || Node.isImportSpecifier(decl)) {
    const next = resolveDeclarations(decl.getNameNode());
    return next.length ? next : [decl];
  }
  if (Node.isVariableDeclaration(decl)) {
    const init = unwrapExpression(decl.getInitializer());
    if (init && Node.isIdentifier(init) && !describeDeclaration(decl)) {
      const next = resolveDeclarations(init).filter((d) => d !== decl);
      return next.length ? next.flatMap((d) => followDeclaration(d, depth + 1)) : [decl];
    }
  }
  return [decl];
}

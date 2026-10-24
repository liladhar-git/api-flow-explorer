import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { AnalyzerOptions, FileFacts, StaticString, SymbolDecl } from '../types/analyzer';
import type { AnalysisDiagnostic } from '../types/diagnostics';
import type { WorkspaceMeta } from '../scanner/packageDiscovery';
import { ALWAYS_IGNORED_DIRS } from '../scanner/ignoreRules';
import { symId } from '../graph/ids';
import { describeDeclaration, resolveDeclarations, unwrapExpression } from './symbolResolver';
import { docSummary } from './docs';
import { evalString, isStringLike } from './staticString';

export interface ProjectInfo {
  root: string;
  options: AnalyzerOptions;
  meta: WorkspaceMeta;
}

/** Syntax kinds collected in a single traversal so adapters don't each re-walk the tree. */
const COLLECTED = [
  SyntaxKind.CallExpression,
  SyntaxKind.NewExpression,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.VariableDeclaration,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
  SyntaxKind.Constructor,
  SyntaxKind.PropertyDeclaration,
  SyntaxKind.PropertyAssignment,
  SyntaxKind.ExportAssignment,
  SyntaxKind.JsxOpeningElement,
  SyntaxKind.JsxSelfClosingElement,
  SyntaxKind.JsxFragment,
] as const;

const DECLARING = new Set<SyntaxKind>([
  SyntaxKind.ClassDeclaration,
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.VariableDeclaration,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
  SyntaxKind.Constructor,
  SyntaxKind.PropertyDeclaration,
  SyntaxKind.PropertyAssignment,
  SyntaxKind.ExportAssignment,
]);

export class FileContext {
  readonly facts: FileFacts;
  readonly deps = new Set<string>();
  /** function-like / class node → symbol id that owns calls made inside it. */
  readonly ownerByNode = new Map<Node, string>();
  readonly symbolById = new Map<string, SymbolDecl>();
  private readonly byKind = new Map<SyntaxKind, Node[]>();
  private moduleSymbolAdded = false;

  constructor(
    readonly sf: SourceFile,
    readonly path: string,
    readonly project: ProjectInfo,
    hash: string,
  ) {
    this.facts = {
      path,
      hash,
      deps: [],
      hasUnresolved: false,
      boundary: 'unknown',
      symbols: [],
      nodes: [],
      edges: [],
      calls: [],
      requests: [],
      diagnostics: [],
      unresolvedCalls: 0,
    };
    this.collect();
    this.declareSymbols();
  }

  private collect(): void {
    const wanted = new Set<SyntaxKind>(COLLECTED);
    this.sf.forEachDescendant((node) => {
      const k = node.getKind();
      if (wanted.has(k)) {
        let list = this.byKind.get(k);
        if (!list) this.byKind.set(k, (list = []));
        list.push(node);
      }
    });
  }

  nodesOf<T extends Node>(kind: SyntaxKind): T[] {
    return (this.byKind.get(kind) as T[] | undefined) ?? [];
  }

  /** Workspace-relative path of a source file, or undefined if outside the workspace / ignored / generated. */
  relPathOfFile(file: SourceFile): string | undefined {
    const abs = file.getFilePath();
    if (!abs.startsWith(this.project.root + '/')) return undefined;
    const rel = abs.slice(this.project.root.length + 1);
    const segs = rel.split('/');
    if (segs.some((s) => ALWAYS_IGNORED_DIRS.has(s))) return undefined;
    if (/\.d\.[cm]?ts$/.test(rel)) return undefined;
    return rel;
  }

  /** Records that this file's facts depend on the file containing `node`. */
  touch(node: Node): void {
    const rel = this.relPathOfFile(node.getSourceFile());
    if (rel && rel !== this.path) this.deps.add(rel);
  }

  /** Declarations `node` refers to (aliases followed); every foreign file reached becomes a dependency. */
  resolve(node: Node): Node[] {
    const decls = resolveDeclarations(node);
    for (const d of decls) this.touch(d);
    return decls;
  }

  /** Stable symbol id for a declaration anywhere in the workspace, or undefined if it is not one of ours. */
  symbolIdOf(decl: Node): { id: string; qualified: string; path: string } | undefined {
    const rel = this.relPathOfFile(decl.getSourceFile());
    if (!rel) return undefined;
    const d = describeDeclaration(decl);
    return d ? { id: symId(rel, d.qualified), qualified: d.qualified, path: rel } : undefined;
  }

  private exportedOf(decl: Node): boolean {
    if (Node.isVariableDeclaration(decl)) return decl.getVariableStatement()?.isExported() ?? false;
    if (Node.isExportAssignment(decl)) return true;
    if (Node.isPropertyAssignment(decl)) return false;
    const parent = decl.getParent();
    if (parent && (Node.isClassDeclaration(parent) || Node.isClassExpression(parent)) && !Node.isClassDeclaration(decl)) return Node.isClassDeclaration(parent) && parent.isExported();
    return Node.isExportable(decl) ? decl.isExported() : false;
  }

  private declareSymbols(): void {
    for (const kind of DECLARING) {
      for (const node of this.nodesOf(kind)) {
        const d = describeDeclaration(node);
        if (!d) continue;
        const id = symId(this.path, d.qualified);
        if (this.symbolById.has(id)) continue; // overload signatures
        const decl: SymbolDecl = {
          id,
          name: d.name,
          qualified: d.qualified,
          kind: 'function',
          line: node.getStartLineNumber(),
          endLine: node.getEndLineNumber(),
          column: node.getStart() - node.getStartLinePos() + 1,
          exported: this.exportedOf(node),
          meta: { symbolType: d.symbolType, ...(docSummary(node) ? { description: docSummary(node)! } : {}) },
        };
        this.symbolById.set(id, decl);
        this.facts.symbols.push(decl);
        this.ownerByNode.set(d.owner, id);
        if (Node.isClassDeclaration(node)) this.ownerByNode.set(node, id);
      }
    }
  }

  /** Changes a symbol's node kind (e.g. function → frontend-component) and merges metadata. */
  classify(id: string, kind: SymbolDecl['kind'], meta: SymbolDecl['meta'] = {}): void {
    const s = this.symbolById.get(id);
    if (!s) return;
    s.kind = kind;
    s.meta = { ...s.meta, ...meta };
  }

  /** Registers an anonymous function (e.g. an inline route handler) as its own symbol so calls inside it have an owner. */
  declareAnonymous(fn: Node, qualified: string, kind: SymbolDecl['kind'], meta: SymbolDecl['meta'] = {}, displayName?: string): string {
    const id = symId(this.path, qualified);
    if (!this.symbolById.has(id)) {
      const decl: SymbolDecl = {
        id,
        name: displayName ?? qualified,
        qualified,
        kind,
        line: fn.getStartLineNumber(),
        endLine: fn.getEndLineNumber(),
        column: fn.getStart() - fn.getStartLinePos() + 1,
        exported: false,
        meta: { symbolType: 'arrow', anonymous: true, ...meta },
      };
      this.symbolById.set(id, decl);
      this.facts.symbols.push(decl);
    }
    this.ownerByNode.set(fn, id);
    return id;
  }

  ownerNodeOf(node: Node): Node | undefined {
    let n: Node | undefined = node;
    while (n) {
      if (this.ownerByNode.has(n)) return n;
      n = n.getParent();
    }
    return undefined;
  }

  /** Symbol that lexically contains `node`; module-level code is attributed to a synthetic `<module>` symbol. */
  ownerOf(node: Node): string {
    const owner = this.ownerNodeOf(node);
    if (owner) return this.ownerByNode.get(owner)!;
    return this.moduleSymbol();
  }

  moduleSymbol(): string {
    const id = symId(this.path, '<module>');
    if (!this.moduleSymbolAdded) {
      this.moduleSymbolAdded = true;
      this.symbolById.set(id, {
        id,
        name: `${this.path.split('/').pop()} (module)`,
        qualified: '<module>',
        kind: 'function',
        line: 1,
        endLine: this.sf.getEndLineNumber(),
        column: 1,
        exported: false,
        meta: { symbolType: 'module' },
      });
      this.facts.symbols.push(this.symbolById.get(id)!);
    }
    return id;
  }

  staticValue(node: Node | undefined, within?: Node): StaticString {
    const ownerFn = within ? this.ownerNodeOf(within) : undefined;
    return evalString(node, { ownerFn, touched: (n) => this.touch(n) });
  }

  /**
   * Path-like argument: a string expression, or an identifier / member access that evaluates to a constant string
   * (e.g. an imported `USERS_PATH`). Anything else — functions, unresolved values — is not a path.
   */
  evalPath(node: Node | undefined): StaticString | undefined {
    const e = unwrapExpression(node);
    if (!e) return undefined;
    if (isStringLike(e)) return this.staticValue(e, node);
    if (Node.isIdentifier(e) || Node.isPropertyAccessExpression(e)) {
      const v = this.staticValue(e, node);
      return v.some((p) => typeof p === 'string' && p !== '') ? v : undefined;
    }
    return undefined;
  }

  line(node: Node): number {
    return node.getStartLineNumber();
  }

  column(node: Node): number {
    return node.getStart() - node.getStartLinePos() + 1;
  }

  diag(d: AnalysisDiagnostic): void {
    this.facts.diagnostics.push(d);
  }

  warn(code: AnalysisDiagnostic['code'], message: string, node?: Node): void {
    this.diag({ severity: 'warning', code, message, path: this.path, line: node?.getStartLineNumber() });
  }

  info(code: AnalysisDiagnostic['code'], message: string, node?: Node): void {
    this.diag({ severity: 'info', code, message, path: this.path, line: node?.getStartLineNumber() });
  }
}

import { Node, SyntaxKind, ts, type SourceFile } from 'ts-morph';
import type { FileFacts } from '../types/analyzer';
import { fileImports } from './importResolver';
import { buildCallFacts } from './callGraphBuilder';
import { redactDeep } from './redact';
import { FileContext, type ProjectInfo } from './fileContext';
import type { FrameworkAdapter } from './adapters/shared/adapter';

function detectBoundary(sf: SourceFile): FileFacts['boundary'] {
  for (const st of sf.getStatements()) {
    if (!Node.isExpressionStatement(st)) break;
    const e = st.getExpression();
    if (Node.isStringLiteral(e)) {
      if (e.getLiteralText() === 'use client') return 'client';
      if (e.getLiteralText() === 'use server') return 'server';
    } else break;
  }
  return 'unknown';
}

function reportImports(ctx: FileContext): void {
  const { sf, project } = ctx;
  const patterns = project.meta.pathMappings.map((m) => m.pattern.replace(/\*.*$/, ''));
  const classify = (spec: string, node: Node) => {
    if (/\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot|mp[34]|webm|md|mdx|txt|graphql|gql)(\?.*)?$/i.test(spec)) return; // assets, not source
    const relative = spec.startsWith('.');
    const aliasLike = patterns.some((p) => p !== '' && spec.startsWith(p)) || /^(@|~|#)\//.test(spec) || spec.startsWith('#');
    if (relative) {
      ctx.facts.hasUnresolved = true;
      ctx.warn('unresolved-import', `Cannot resolve import "${spec}"`, node);
    } else if (aliasLike) {
      ctx.facts.hasUnresolved = true;
      ctx.warn('unresolved-alias', `Cannot resolve path alias "${spec}" (no matching tsconfig paths entry, or target file missing)`, node);
    }
  };
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    const target = imp.getModuleSpecifierSourceFile();
    if (target) ctx.touch(target);
    else classify(spec, imp);
  }
  for (const exp of sf.getExportDeclarations()) {
    const spec = exp.getModuleSpecifierValue();
    if (!spec) continue;
    const target = exp.getModuleSpecifierSourceFile();
    if (target) ctx.touch(target);
    else classify(spec, exp);
  }
  let dynamicLiteral = 0;
  for (const call of ctx.nodesOf<import('ts-morph').CallExpression>(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const arg = call.getArguments()[0];
    if (callee.getKind() === SyntaxKind.ImportKeyword) {
      if (arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) dynamicLiteral++;
      else ctx.warn('dynamic-import', 'Dynamic import() with a non-literal specifier is not followed', call);
    } else if (Node.isIdentifier(callee) && callee.getText() === 'require' && arg && Node.isStringLiteral(arg)) {
      const spec = arg.getLiteralText();
      if (spec.startsWith('.')) {
        const resolved = ts.resolveModuleName(spec, sf.getFilePath(), sf.getProject().getCompilerOptions(), sf.getProject().getModuleResolutionHost());
        if (!resolved.resolvedModule) classify(spec, call);
        else {
          const f = sf.getProject().getSourceFile(resolved.resolvedModule.resolvedFileName);
          if (f) ctx.touch(f);
        }
      }
    }
  }
  if (dynamicLiteral > 0) ctx.info('dynamic-import', `${dynamicLiteral} dynamic import() call(s) with literal specifiers are not followed`);
}

/**
 * Plain functions have no framework classification, so record which side of the stack their file is on:
 * React/JSX files and `'use client'` files are frontend. Server-only code (Next handlers, `getServerSideProps`) is not.
 */
function tagLayers(ctx: FileContext): void {
  const frontendFile = ctx.facts.boundary === 'client' || /\.(tsx|jsx)$/.test(ctx.path) || fileImports(ctx.sf, ['react', 'react-dom']);
  if (!frontendFile) return;
  for (const sym of ctx.facts.symbols) {
    if (sym.kind === 'function' && sym.meta.executes !== 'server' && sym.meta.layer === undefined) sym.meta = { ...sym.meta, layer: 'frontend' };
  }
}

/**
 * Extracts every cacheable fact about one file. Adapters run before call extraction so they can
 * classify symbols and register anonymous handlers as call owners. Never throws: a failure in one
 * adapter becomes a diagnostic and other adapters still run.
 */
export function analyzeSourceFile(sf: SourceFile, path: string, hash: string, project: ProjectInfo, adapters: FrameworkAdapter[]): FileFacts {
  const ctx = new FileContext(sf, path, project, hash);
  ctx.facts.boundary = detectBoundary(sf);

  const parseDiags = ((sf.compilerNode as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []).slice(0, 3);
  for (const d of parseDiags) {
    const line = d.start !== undefined ? sf.compilerNode.getLineAndCharacterOfPosition(d.start).line + 1 : undefined;
    ctx.diag({ severity: 'warning', code: 'parse-error', message: `Syntax error: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`, path, line });
  }

  const guard = (label: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      ctx.diag({ severity: 'warning', code: 'internal', message: `${label} failed: ${(e as Error).message}`, path });
    }
  };

  guard('import analysis', () => reportImports(ctx));
  for (const adapter of adapters) guard(`adapter ${adapter.name}`, () => adapter.extract(ctx));
  guard('call graph', () => buildCallFacts(ctx));

  guard('layer tagging', () => tagLayers(ctx));

  ctx.facts.deps = [...ctx.deps].sort();
  return redactDeep(ctx.facts);
}

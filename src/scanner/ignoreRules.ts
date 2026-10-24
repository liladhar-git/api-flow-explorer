import * as path from 'node:path';

/** Directories that are never analyzed (generated output, dependencies, VCS data). */
export const ALWAYS_IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.output', '.turbo',
  '.cache', '.parcel-cache', 'coverage', '.nyc_output', '.vscode-test', '.api-flow-cache', '.yarn', '.pnpm-store',
  '.idea', '.vscode', '.angular', '.svelte-kit', 'storybook-static', '__pycache__', 'vendor', 'bower_components',
]);

export const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

const SECRET_BASENAMES = [/^\.env(\..*)?$/i, /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, /^\.npmrc$/, /^\.netrc$/, /^credentials(\..*)?$/i, /^secrets?(\..*)?$/i];
const SECRET_EXTENSIONS = new Set(['.pem', '.key', '.crt', '.cer', '.p12', '.pfx', '.jks', '.keystore']);

/** Files that must never be read or indexed, even if they match a source extension. */
export function isSecretFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (SECRET_BASENAMES.some((re) => re.test(base))) return true;
  return SECRET_EXTENSIONS.has(path.extname(base).toLowerCase());
}

const TEST_FILE = /\.(test|spec|e2e-spec|stories)\.[cm]?[jt]sx?$/;
const TEST_DIRS = new Set(['__tests__', '__mocks__', 'test', 'tests', 'e2e', 'cypress', '__fixtures__']);

export function isTestFile(relPath: string): boolean {
  if (TEST_FILE.test(relPath)) return true;
  return relPath.split('/').slice(0, -1).some((seg) => TEST_DIRS.has(seg));
}

export function isDeclarationFile(name: string): boolean {
  return /\.d\.[cm]?ts$/.test(name);
}

export interface IgnoreOptions {
  ignoredDirectories: string[];
  includeTests: boolean;
}

export function makeDirFilter(opts: IgnoreOptions): (name: string) => boolean {
  const extra = new Set(opts.ignoredDirectories);
  return (name) => ALWAYS_IGNORED_DIRS.has(name) || extra.has(name);
}

/**
 * The TypeScript parser and our own tree walks are recursive, so a file with thousands of nested brackets can overflow
 * the stack and abort the whole scan. Real code nests far less than this; such a file is skipped with a diagnostic.
 */
export const MAX_BRACKET_DEPTH = 250;

export function exceedsBracketDepth(text: string, limit = MAX_BRACKET_DEPTH): boolean {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 40 || c === 91 || c === 123) {
      if (++depth > limit) return true;
    } else if ((c === 41 || c === 93 || c === 125) && depth > 0) depth--;
  }
  return false;
}

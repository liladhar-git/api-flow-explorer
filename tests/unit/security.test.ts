import { describe, expect, it } from 'vitest';
import { redact, redactDeep } from '../../src/analyzer/redact';

describe('redaction', () => {
  it('removes credentials from URLs, query strings and well-known token formats', () => {
    expect(redact('https://user:p4ss@host.test/x')).toBe('https://***@host.test/x');
    expect(redact('/v1/items?api_key=abc123&page=2')).toBe('/v1/items?api_key=***&page=2');
    expect(redact('/cb?access_token=zzz&x=1&client_secret=yyy')).toBe('/cb?access_token=***&x=1&client_secret=***');
    expect(redact('key sk_live_abcdefgh12345678 end')).toBe('key *** end');
    expect(redact('AKIAABCDEFGHIJKLMNOP')).toBe('***');
    expect(redact('Authorization: Bearer abcdefghijklmnop1234')).toBe('Authorization: Bearer ***');
    expect(redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N')).toBe('***');
  });

  it('leaves ordinary paths, ids and URLs untouched', () => {
    for (const s of ['/api/users/:id', 'https://api.example.com/v1/users?page=2&limit=10', 'sym:src/a.ts#Foo.bar', 'endpoint:GET /health@server/app.ts:14', 'keyboard=1']) expect(redact(s)).toBe(s);
  });

  it('redacts every string inside nested facts', () => {
    const facts = { a: ['x?token=abc'], b: { c: 'https://u:p@h/' }, n: 5, ok: true };
    expect(redactDeep(facts)).toEqual({ a: ['x?token=***'], b: { c: 'https://***@h/' }, n: 5, ok: true });
  });

  it('is linear-time on adversarial input (ReDoS regression)', () => {
    const inputs = [
      '&' + 'key'.repeat(300_000),
      '?' + 'a'.repeat(1_000_000),
      '//' + 'a'.repeat(1_000_000),
      '//a'.repeat(300_000),
      'Bearer ' + 'a'.repeat(1_000_000),
      'eyJ' + 'a'.repeat(1_000_000),
      '&token' + '='.repeat(500_000),
    ];
    for (const s of inputs) {
      const t = performance.now();
      redact(s);
      expect(performance.now() - t).toBeLessThan(1500);
    }
  });
});

import { afterAll } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { analyzeProject } from '../../src/analyzer/projectAnalyzer';
import { validateGraph } from '../../src/graph/graphValidator';
import { copyFixture } from './helpers';
import { exceedsBracketDepth } from '../../src/scanner/ignoreRules';

describe('bracket depth guard', () => {
  it('flags only pathological nesting', () => {
    expect(exceedsBracketDepth('('.repeat(300))).toBe(true);
    expect(exceedsBracketDepth('{'.repeat(250) + '}'.repeat(250))).toBe(false);
    expect(exceedsBracketDepth('function f(){ if (a) { return [1,{b:(2)}]; } }')).toBe(false);
    expect(exceedsBracketDepth(')'.repeat(1000) + '(')).toBe(false); // closers never go negative
  });
});

describe('hostile and malformed input', () => {
  const cleanups: (() => void)[] = [];
  afterAll(() => cleanups.forEach((c) => c()));

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
    }
    return out;
  }

  it('survives truncated and corrupted copies of real files', async () => {
    for (const fixture of ['nestjs', 'react-express', 'nextjs']) {
      const ws = copyFixture(fixture);
      cleanups.push(ws.cleanup);
      let i = 0;
      for (const f of walk(ws.root)) {
        const text = readFileSync(f, 'utf8');
        const cut = Math.floor((text.length * (1 + (i++ % 3))) / 4);
        writeFileSync(f, i % 4 === 0 ? text.slice(cut) + '}}}(((' : i % 5 === 0 ? text.slice(0, cut) + '\u0000�`${' : text.slice(0, cut));
      }
      const r = await analyzeProject({ root: ws.root, ignoredDirectories: [], includeTests: false, maxFiles: 1000, baseUrls: {} });
      expect(validateGraph(r.graph).ok, fixture).toBe(true);
      expect(r.report.cancelled).toBe(false);
    }
  });

  it('survives pathological syntax: deep nesting, huge literals, circular re-exports, binary content', async () => {
    const ws = copyFixture('edge-cases');
    cleanups.push(ws.cleanup);
    const src = path.join(ws.root, 'src');
    writeFileSync(path.join(src, 'deep.ts'), `export const x = ${'('.repeat(3000)}1${')'.repeat(3000)};\nexport const y = ${'['.repeat(2000)}${']'.repeat(2000)};\n`);
    writeFileSync(path.join(src, 'concat.ts'), `const u = ${Array.from({ length: 4000 }, (_, i) => `'a${i}'`).join(' + ')};\nfetch(u);\n`);
    writeFileSync(path.join(src, 'huge.ts'), `fetch('/x?${'api_key='.repeat(50_000)}');\nexport const s = '${'&key'.repeat(100_000)}';\n`);
    writeFileSync(path.join(src, 'a.ts'), "export * from './b';\nexport function fa() { return fb(); }\nexport function fb() { return 1; }\n");
    writeFileSync(path.join(src, 'b.ts'), "export * from './a';\nexport const b = 1;\n");
    writeFileSync(path.join(src, 'binary.ts'), Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37) % 256)));
    writeFileSync(path.join(src, 'empty.ts'), '');
    const t = performance.now();
    const r = await analyzeProject({ root: ws.root, ignoredDirectories: [], includeTests: false, maxFiles: 1000, baseUrls: {} });
    expect(performance.now() - t).toBeLessThan(30_000);
    expect(validateGraph(r.graph).ok).toBe(true);
    expect(r.graph.nodes.some((n) => n.id === 'sym:src/a.ts#fa')).toBe(true); // circular re-exports do not stop analysis
    // the hostile files are reported, not parsed, and a file importing one of them is still analyzed
    expect(r.report.diagnostics.filter((d) => d.code === 'file-skipped' && /nesting/.test(d.message)).map((d) => d.path)).toEqual(['src/deep.ts']);
  }, 60_000);

  it('does not let an import of a pathological file crash analysis of its importer', async () => {
    const ws = copyFixture('edge-cases');
    cleanups.push(ws.cleanup);
    const src = path.join(ws.root, 'src');
    writeFileSync(path.join(src, 'deep.ts'), `export const x = ${'('.repeat(5000)}1${')'.repeat(5000)};\n`);
    writeFileSync(path.join(src, 'user.ts'), "import { x } from './deep';\nexport function useX() { return helper() + x; }\nfunction helper() { return 1; }\n");
    const r = await analyzeProject({ root: ws.root, ignoredDirectories: [], includeTests: false, maxFiles: 1000, baseUrls: {} });
    expect(r.graph.nodes.some((n) => n.id === 'sym:src/user.ts#useX')).toBe(true);
    expect(r.report.diagnostics.some((d) => d.code === 'file-skipped' && d.path === 'src/deep.ts')).toBe(true);
  }, 60_000);

  it('does not follow symlinks out of the workspace', async () => {
    const ws = copyFixture('edge-cases');
    cleanups.push(ws.cleanup);
    const outside = copyFixture('react-express');
    cleanups.push(outside.cleanup);
    mkdirSync(path.join(ws.root, 'linked'), { recursive: true });
    symlinkSync(outside.root, path.join(ws.root, 'linked', 'escape'), 'dir');
    symlinkSync(path.join(ws.root, 'src'), path.join(ws.root, 'src', 'loop'), 'dir');
    const r = await analyzeProject({ root: ws.root, ignoredDirectories: [], includeTests: false, maxFiles: 1000, baseUrls: {} });
    expect(r.graph.nodes.some((n) => (n.path ?? '').includes('linked/'))).toBe(false);
    expect(JSON.stringify(r.graph)).not.toContain('userService');
    expect(r.report.filesDiscovered).toBe(2);
  });

  it('enforces the file-count limit with a diagnostic', async () => {
    const r = await analyzeProject({ root: path.resolve(__dirname, '../fixtures/react-express'), ignoredDirectories: [], includeTests: false, maxFiles: 3, baseUrls: {} });
    expect(r.report.filesDiscovered).toBe(3);
    expect(r.report.diagnostics.some((d) => d.code === 'file-limit')).toBe(true);
  });

  it('skips oversized files instead of parsing them', async () => {
    const ws = copyFixture('edge-cases');
    cleanups.push(ws.cleanup);
    writeFileSync(path.join(ws.root, 'src', 'bundle.js'), 'var a = 1;\n'.repeat(200_000));
    const r = await analyzeProject({ root: ws.root, ignoredDirectories: [], includeTests: false, maxFiles: 1000, baseUrls: {} });
    expect(r.report.filesSkipped.some((s) => s.path === 'src/bundle.js' && /too large/.test(s.reason))).toBe(true);
    expect(r.graph.nodes.some((n) => n.path === 'src/bundle.js')).toBe(false);
  });
});

import { linkFacts } from '../../src/analyzer/linker';
import type { FileFacts } from '../../src/types/analyzer';

describe('scale: very large diagnostic and candidate sets', () => {
  it('links facts carrying hundreds of thousands of diagnostics without overflowing the stack', () => {
    const f: FileFacts = {
      path: 'a.ts', hash: 'h', deps: [], hasUnresolved: false, boundary: 'unknown', symbols: [], nodes: [], edges: [], calls: [], requests: [], unresolvedCalls: 0,
      diagnostics: Array.from({ length: 400_000 }, (_, i) => ({ severity: 'info' as const, code: 'dynamic-route' as const, message: `d${i}`, path: 'a.ts', line: 1 })),
    };
    const r = linkFacts(new Map([['a.ts', f]]), { root: '/x', ignoredDirectories: [], includeTests: false, maxFiles: 1, baseUrls: {} }, { packages: [], pathMappings: [], compilerOptions: {}, diagnostics: [] }, []);
    expect(r.diagnostics).toHaveLength(400_000);
  });
});

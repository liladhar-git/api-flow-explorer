import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}
const hash = createHash('sha1');
for (const f of sourceFiles('src').sort()) hash.update(f).update(readFileSync(f));
const analyzerBuild = `${pkg.version}+${hash.digest('hex').slice(0, 12)}`;

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
  legalComments: 'none',
  define: { __ANALYZER_BUILD__: JSON.stringify(analyzerBuild) },
};

await build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] });
if (existsSync('src/analyzer/worker.ts')) await build({ ...common, entryPoints: ['src/analyzer/worker.ts'], outfile: 'dist/analyzer-worker.js' });

// Sidebar webview view (React, no Zod): its own small browser bundle
await build({
  entryPoints: ['webview/src/sidebar/main.tsx'],
  outdir: 'dist/webview-sidebar',
  entryNames: 'index',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  target: 'es2022',
  minify: true,
  logLevel: 'info',
  legalComments: 'none',
});

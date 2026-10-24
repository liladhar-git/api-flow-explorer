import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { analyzeProject } from '../../src/analyzer/projectAnalyzer';
import { analyzeInWorker, CancelledError } from '../../src/analyzer/runInWorker';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(__dirname, '../..');
const WS = path.join(ROOT, '.test-tmp/cancel-ws');

function generate(files: number) {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(path.join(WS, 'src'), { recursive: true });
  writeFileSync(path.join(WS, 'package.json'), '{"name":"c","dependencies":{"express":"4"}}');
  for (let i = 0; i < files; i++) {
    const next = (i + 1) % files;
    writeFileSync(path.join(WS, 'src', `m${i}.ts`), `import { f${next} } from './m${next}';\nexport function f${i}(x: number) { return f${next}(x + ${i}); }\n`);
  }
}

afterAll(() => rmSync(WS, { recursive: true, force: true }));

describe('cancellation', () => {
  it('in-process analysis stops promptly and reports cancelled with an empty graph', async () => {
    generate(1200);
    let cancel = false;
    const t0 = Date.now();
    const result = await analyzeProject(
      { root: WS, ignoredDirectories: [], includeTests: false, maxFiles: 5000, baseUrls: {} },
      { token: { get isCancellationRequested() { return cancel; } }, onProgress: (p) => { if (p.phase === 'parse' && (p.done ?? 0) >= 25) cancel = true; } },
    );
    expect(result.report.cancelled).toBe(true);
    expect(result.graph.nodes).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 60_000);

  it('cancelling the worker rejects with CancelledError and terminates it', async () => {
    const workerPath = path.join(ROOT, 'dist/analyzer-worker.js');
    if (!existsSync(workerPath)) execSync('npm run build:ext', { cwd: ROOT, stdio: 'ignore' });
    generate(2500);
    const listeners: (() => void)[] = [];
    const token = { isCancellationRequested: false, onCancellationRequested: (cb: () => void) => (listeners.push(cb), { dispose() {} }) };
    const started = Date.now();
    let progressSeen = false;
    const run = analyzeInWorker({
      workerPath,
      options: { root: WS, ignoredDirectories: [], includeTests: false, maxFiles: 5000, baseUrls: {} },
      token,
      onProgress: () => {
        if (!progressSeen) {
          progressSeen = true;
          setTimeout(() => { token.isCancellationRequested = true; listeners.forEach((l) => l()); }, 100);
        }
      },
    });
    await expect(run).rejects.toBeInstanceOf(CancelledError);
    expect(Date.now() - started).toBeLessThan(15_000);
    // a token that is already cancelled never starts work
    const pre = { isCancellationRequested: true, onCancellationRequested: () => ({ dispose() {} }) };
    await expect(analyzeInWorker({ workerPath, options: { root: WS, ignoredDirectories: [], includeTests: false, maxFiles: 10, baseUrls: {} }, token: pre })).rejects.toBeInstanceOf(CancelledError);
  }, 90_000);
});

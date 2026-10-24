import { Worker } from 'node:worker_threads';
import type { AnalysisResult, AnalyzerOptions, CancellationLike, ScanProgress } from '../types/analyzer';

export interface WorkerRunOptions {
  /** Absolute path of dist/analyzer-worker.js. */
  workerPath: string;
  options: AnalyzerOptions;
  token?: { onCancellationRequested(cb: () => void): { dispose(): void } } & CancellationLike;
  onProgress?: (p: ScanProgress) => void;
}

/** Runs the analyzer in a worker thread so large scans never block the extension host. Cancellation terminates the worker. */
export function analyzeInWorker(run: WorkerRunOptions): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(run.workerPath, { workerData: run.options, resourceLimits: { maxOldGenerationSizeMb: 4096 } });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      sub?.dispose();
      void worker.terminate();
      fn();
    };
    const sub = run.token?.onCancellationRequested(() => finish(() => reject(new CancelledError())));
    if (run.token?.isCancellationRequested) return finish(() => reject(new CancelledError()));
    worker.on('message', (m: { type: string; progress?: ScanProgress; result?: AnalysisResult; message?: string; stack?: string }) => {
      if (m.type === 'progress' && m.progress) run.onProgress?.(m.progress);
      else if (m.type === 'result' && m.result) finish(() => resolve(m.result!));
      else if (m.type === 'error') finish(() => reject(Object.assign(new Error(m.message), { workerStack: m.stack })));
    });
    worker.on('error', (e) => finish(() => reject(e)));
    worker.on('exit', (code) => finish(() => reject(new Error(`analyzer worker exited with code ${code}`))));
  });
}

export class CancelledError extends Error {
  constructor() {
    super('Scan cancelled');
  }
}

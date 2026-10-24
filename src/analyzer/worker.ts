import { parentPort, workerData } from 'node:worker_threads';
import type { AnalyzerOptions } from '../types/analyzer';
import { analyzeProject } from './projectAnalyzer';

/**
 * Runs the analysis off the extension host thread so VS Code stays responsive.
 * Cancellation is done by the host terminating this worker.
 */
async function main() {
  const options = workerData as AnalyzerOptions;
  try {
    const result = await analyzeProject(options, { onProgress: (p) => parentPort?.postMessage({ type: 'progress', progress: p }) });
    parentPort?.postMessage({ type: 'result', result });
  } catch (e) {
    parentPort?.postMessage({ type: 'error', message: (e as Error).message, stack: (e as Error).stack });
  }
}
void main();

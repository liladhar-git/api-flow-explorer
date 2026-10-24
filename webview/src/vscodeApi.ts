import type { WebviewToHost } from '../../src/messaging/messageSchemas';

interface VsCodeApi {
  postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

export function post(message: WebviewToHost): void {
  if (!api) api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage: () => undefined };
  api.postMessage(message);
}

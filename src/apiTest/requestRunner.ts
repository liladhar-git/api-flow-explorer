import type { ApiRequest, ApiResponse } from '../types/apiTest';
import { resolveHeaders, resolveRequestUrl, substituteVariables } from '../types/apiTest';
import { parseLenientJson } from '../types/jsonLenient';

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB truncation limit

/** Executes an API request with timeout, truncation, and timing measurements */
export async function executeApiRequest(
  request: ApiRequest,
  variables: Record<string, string> = {},
  externalSignal?: AbortSignal,
  maxBytes: number = MAX_RESPONSE_BYTES
): Promise<ApiResponse> {
  const startTime = Date.now();
  const perfStart = performance.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`Request timed out after ${request.timeoutMs ?? 30000}ms`)), request.timeoutMs ?? 30000);

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.abort(externalSignal.reason);
      });
    }
  }

  try {
    const fullUrl = resolveRequestUrl(request.url, request.queryParams, variables, request.pathParams);
    const headers = resolveHeaders(request, variables);

    const init: RequestInit = {
      method: request.method,
      headers,
      signal: controller.signal,
    };

    if (request.method !== 'GET' && request.method !== 'HEAD' && request.body && request.body.type !== 'none') {
      const bodyStr = substituteVariables(request.body.content ?? '', variables);
      if (request.body.type === 'json' && bodyStr.trim()) {
        // tolerate pasted JS-style literals (comments, trailing commas, single quotes, unquoted keys); send strict JSON
        const parsed = parseLenientJson(bodyStr);
        if (!parsed.ok) throw new Error(`Invalid JSON body: ${parsed.error}${parsed.line ? ` (line ${parsed.line}, column ${parsed.column})` : ''}`);
        init.body = JSON.stringify(parsed.value);
      } else init.body = bodyStr;
    }

    const res = await fetch(fullUrl, init);
    clearTimeout(timeoutId);

    const perfEnd = performance.now();
    const durationMs = Math.round(perfEnd - perfStart);

    // Collect response headers
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((val, key) => {
      resHeaders[key.toLowerCase()] = val;
    });

    // Read and buffer response body with size limit
    const arrayBuffer = await res.arrayBuffer();
    const sizeBytes = arrayBuffer.byteLength;
    const isTruncated = sizeBytes > maxBytes;
    const slice = isTruncated ? arrayBuffer.slice(0, maxBytes) : arrayBuffer;
    const bodyText = new TextDecoder('utf-8').decode(slice);

    const isJson = (resHeaders['content-type'] ?? '').includes('application/json');

    return {
      requestId: request.id,
      status: res.status,
      statusText: res.statusText || String(res.status),
      durationMs,
      sizeBytes,
      headers: resHeaders,
      body: bodyText,
      isJson,
      truncated: isTruncated,
      timing: {
        start: startTime,
        end: Date.now(),
      },
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const perfEnd = performance.now();
    const durationMs = Math.round(perfEnd - perfStart);
    const errorMsg = err instanceof Error ? err.message : String(err);

    return {
      requestId: request.id,
      status: 0,
      statusText: 'Client Error',
      durationMs,
      sizeBytes: 0,
      headers: {},
      body: '',
      isJson: false,
      truncated: false,
      error: errorMsg,
      timing: {
        start: startTime,
        end: Date.now(),
      },
    };
  }
}
export { generateCurlCommand, resolveHeaders, resolveRequestUrl, substituteVariables } from '../types/apiTest';

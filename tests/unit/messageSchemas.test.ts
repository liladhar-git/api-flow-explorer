import { describe, expect, it } from 'vitest';
import { WebviewToHostSchema, HostToWebviewSchema } from '../../src/messaging/messageSchemas';

describe('webview message validation', () => {
  it('accepts well-formed messages and applies defaults', () => {
    expect(WebviewToHostSchema.parse({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(WebviewToHostSchema.parse({ type: 'focus', nodeId: 'endpoint:GET /a' })).toMatchObject({ depth: 3 });
  });

  it.each([
    [{ type: 'unknown' }],
    [{ type: 'openNode' }],
    [{ type: 'openNode', nodeId: '' }],
    [{ type: 'focus', nodeId: 'x', depth: 99 }],
    [{ type: 'openFile', path: '/etc/passwd' }],
    ['ready'],
    [null],
  ])('rejects malformed message %j', (msg) => {
    expect(WebviewToHostSchema.safeParse(msg).success).toBe(false);
  });

  it('validates host messages', () => {
    expect(HostToWebviewSchema.safeParse({ type: 'state', hasAnalysis: false, scanning: false }).success).toBe(true);
    expect(HostToWebviewSchema.safeParse({ type: 'state' }).success).toBe(false);
  });

  it('validates API test messages in both directions', () => {
    const validExec = {
      type: 'executeRequest',
      request: {
        id: 'req_1',
        method: 'POST',
        url: 'http://localhost:3000/api/users',
        queryParams: [],
        headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
        auth: { type: 'bearer', token: 'xyz' },
        body: { type: 'json', content: '{"name":"Alice"}' },
        timeoutMs: 10000,
      },
      environmentVariables: { baseUrl: 'http://localhost:3000' },
    };
    expect(WebviewToHostSchema.safeParse(validExec).success).toBe(true);

    const validCancel = { type: 'cancelRequest', requestId: 'req_1' };
    expect(WebviewToHostSchema.safeParse(validCancel).success).toBe(true);

    const validStarted = { type: 'requestStarted', requestId: 'req_1' };
    expect(HostToWebviewSchema.safeParse(validStarted).success).toBe(true);

    const validFinished = {
      type: 'requestFinished',
      response: {
        requestId: 'req_1',
        status: 200,
        statusText: 'OK',
        durationMs: 45,
        sizeBytes: 128,
        headers: { 'content-type': 'application/json' },
        body: '{"status":"success"}',
        isJson: true,
        truncated: false,
        timing: { start: 1000, end: 1045 },
      },
    };
    expect(HostToWebviewSchema.safeParse(validFinished).success).toBe(true);

    const validCancelled = { type: 'requestCancelled', requestId: 'req_1' };
    expect(HostToWebviewSchema.safeParse(validCancelled).success).toBe(true);
  });
});

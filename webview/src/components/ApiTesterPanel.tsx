import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ApiRequest, ApiResponse } from '../../../src/types/apiTest';
import { generateCurlCommand, resolveRequestUrl } from '../../../src/types/apiTest';
import { parseLenientJson } from '../../../src/types/jsonLenient';
import { applyEditorKey } from '../state/jsonEditor';
import { CodeEditor, HighlightedCode } from './CodeEditor';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export interface ApiTesterPanelProps {
  /** Full-page layout: request on the left, response on the right. */
  fullPage?: boolean;
  request: ApiRequest;
  response?: ApiResponse;
  isExecuting: boolean;
  environmentVariables: Record<string, string>;
  onUpdateRequest(req: ApiRequest): void;
  onSetEnvironmentVariable(key: string, value: string): void;
  onExecute(): void;
  onCancel(): void;
}

type ReqSubTab = 'params' | 'headers' | 'auth' | 'body';
type ResSubTab = 'body' | 'headers';

export function ApiTesterPanel({
  fullPage,
  request,
  response,
  isExecuting,
  environmentVariables,
  onUpdateRequest,
  onSetEnvironmentVariable,
  onExecute,
  onCancel,
}: ApiTesterPanelProps) {
  const [reqTab, setReqTab] = useState<ReqSubTab>('params');
  const [resTab, setResTab] = useState<ResSubTab>('body');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [autoFormat, setAutoFormat] = useState(true);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);

  // restore the caret after a controlled update (React would otherwise jump it to the end)
  useLayoutEffect(() => {
    const sel = pendingSelection.current;
    if (sel && bodyRef.current) {
      bodyRef.current.setSelectionRange(sel.start, sel.end);
      pendingSelection.current = null;
    }
  }, [request.body.content]);

  /** JSON responses are pretty-printed so they read like code; anything else is shown as received. */
  const prettyResponse = useMemo(() => {
    const body = response?.body ?? '';
    if (body.length > 400_000 || !/^\s*[{[]/.test(body)) return { text: body, json: false };
    try {
      return { text: JSON.stringify(JSON.parse(body), null, 2), json: true };
    } catch {
      return { text: body, json: /^\s*[{[]/.test(body) }; // truncated/invalid JSON: still colour it
    }
  }, [response?.body]);

  const jsonStatus = useMemo(() => {
    if (request.body.type !== 'json' || !request.body.content.trim()) return null;
    const strictOk = (() => {
      try {
        JSON.parse(request.body.content);
        return true;
      } catch {
        return false;
      }
    })();
    return { ...parseLenientJson(request.body.content), strictOk };
  }, [request.body.type, request.body.content]);

  const baseUrl = environmentVariables['baseUrl'] || 'http://localhost:3000';

  const showCopyMessage = (msg: string) => {
    setCopyFeedback(msg);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const copyCurl = () => {
    const curl = generateCurlCommand(request, environmentVariables);
    void navigator.clipboard.writeText(curl);
    showCopyMessage('cURL copied!');
  };

  const copyTarget = () => {
    void navigator.clipboard.writeText(resolvedPreview);
    showCopyMessage('API URL copied!');
  };

  const copyResponse = () => {
    if (response?.body) {
      void navigator.clipboard.writeText(response.body);
      showCopyMessage('Response copied!');
    }
  };

  const setBody = (content: string, selection?: { start: number; end: number }) => {
    pendingSelection.current = selection ?? null;
    onUpdateRequest({ ...request, body: { ...request.body, content } });
  };

  /** Pretty-prints the body (also repairs comments, trailing commas, single quotes and unquoted keys). */
  const formatJsonBody = () => {
    const r = parseLenientJson(request.body.content);
    if (r.ok && r.text !== request.body.content) setBody(r.text);
  };

  const openBodyTab = () => {
    setReqTab('body');
    if (request.body.type === 'none' && BODY_METHODS.has(request.method)) onUpdateRequest({ ...request, body: { ...request.body, type: 'json' } });
  };

  const changeMethod = (method: ApiRequest['method']) => {
    const needsBody = BODY_METHODS.has(method) && request.body.type === 'none' && !request.body.content.trim();
    onUpdateRequest({ ...request, method, ...(needsBody ? { body: { ...request.body, type: 'json' as const } } : {}) });
  };

  const onBodyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!isExecuting) onExecute();
      return;
    }
    if (request.body.type !== 'json') return;
    if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      formatJsonBody();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.currentTarget;
    const next = applyEditorKey({ value: t.value, start: t.selectionStart, end: t.selectionEnd }, e.key, e.shiftKey);
    if (next) {
      e.preventDefault();
      // text unchanged (stepping over a closer): only the caret moves, and no re-render will restore it for us
      if (next.value === t.value) t.setSelectionRange(next.start, next.end);
      else setBody(next.value, { start: next.start, end: next.end });
    }
  };

  const onBodyPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (request.body.type !== 'json' || !autoFormat) return;
    const pasted = e.clipboardData.getData('text');
    const r = parseLenientJson(pasted);
    if (!r.ok || typeof r.value !== 'object' || r.value === null) return; // only objects/arrays: plain values paste as typed
    e.preventDefault();
    const t = e.currentTarget;
    const value = t.value.slice(0, t.selectionStart) + r.text + t.value.slice(t.selectionEnd);
    const caret = t.selectionStart + r.text.length;
    setBody(value, { start: caret, end: caret });
  };

  const onBodyBlur = () => {
    if (request.body.type === 'json' && autoFormat && request.body.content.trim()) formatJsonBody();
  };

  // Resolved preview URL
  let resolvedPreview = '';
  try {
    resolvedPreview = resolveRequestUrl(request.url, request.queryParams, environmentVariables, request.pathParams);
  } catch {
    resolvedPreview = request.url;
  }

  return (
    <section className={`panel api-tester${fullPage ? ' fullpage' : ''}`} aria-label="API Request Tester">
      <div className="tester-header">
        <h3>API Tester</h3>
        <div className="tester-actions">
          <button className="link" onClick={copyCurl} title="Copy as cURL command">
            📋 cURL
          </button>
          {copyFeedback && <span className="copy-badge">{copyFeedback}</span>}
        </div>
      </div>

      <div className="tester-request">
      {/* Target Base URL configuration */}
      <div className="base-url-bar">
        <label htmlFor="base-url-input">
          <b>Base URL</b> <span className="hint">(all APIs)</span>
        </label>
        <input
          id="base-url-input"
          type="text"
          value={baseUrl}
          onChange={(e) => onSetEnvironmentVariable('baseUrl', e.target.value)}
          placeholder="http://localhost:3000"
          title="Used by every API in the tester and remembered for this workspace"
          className="base-url-input"
        />
      </div>

      {/* Method + Path + Send Button */}
      <div className="request-bar">
        <select
          className={`method-select m-${request.method}`}
          value={request.method}
          onChange={(e) => changeMethod(e.target.value as ApiRequest['method'])}
          aria-label="HTTP Method"
        >
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="url-input"
          value={request.url}
          onChange={(e) => onUpdateRequest({ ...request, url: e.target.value })}
          placeholder="{{baseUrl}}/api/users"
          aria-label="Request URL"
        />
        {isExecuting ? (
          <button className="send-btn cancel-btn" onClick={onCancel} title="Cancel in-flight request">
            ✕ Stop
          </button>
        ) : (
          <button className="send-btn primary" onClick={onExecute} title="Send HTTP request">
            ▶ Send
          </button>
        )}
      </div>

      <div className="preview-url-hint" title={resolvedPreview}>
        Target: <code>{resolvedPreview}</code>
        <button className="link target-copy" onClick={copyTarget} title="Copy the full target URL">Copy URL</button>
      </div>

      {/* Request Tabs: Params | Headers | Auth | Body */}
      <div className="tester-tabs">
        <button className={`tab-btn ${reqTab === 'params' ? 'active' : ''}`} onClick={() => setReqTab('params')}>
          Params {request.queryParams.filter((p) => p.enabled && p.key).length + (request.pathParams?.length ?? 0) > 0 && `(${request.queryParams.filter((p) => p.enabled && p.key).length + (request.pathParams?.length ?? 0)})`}
        </button>
        <button className={`tab-btn ${reqTab === 'headers' ? 'active' : ''}`} onClick={() => setReqTab('headers')}>
          Headers {request.headers.filter((h) => h.enabled && h.key).length > 0 && `(${request.headers.filter((h) => h.enabled && h.key).length})`}
        </button>
        <button className={`tab-btn ${reqTab === 'auth' ? 'active' : ''}`} onClick={() => setReqTab('auth')}>
          Auth {request.auth.type !== 'none' && `(${request.auth.type})`}
        </button>
        <button className={`tab-btn ${reqTab === 'body' ? 'active' : ''}`} onClick={openBodyTab}>
          Body {request.body.type !== 'none' && request.body.content.trim() && '•'}
        </button>
      </div>

      <div className={`tab-content${reqTab === 'body' ? ' body-open' : ''}`}>
        {/* PARAMS TAB */}
        {reqTab === 'params' && (
          <div className="params-tab">
            {(request.pathParams?.length ?? 0) > 0 && (
              <div className="path-vars" aria-label="Path variables">
                <div className="kv-title">Path variables</div>
                {request.pathParams!.map((p, idx) => (
                  <div key={p.key} className="kv-row">
                    <input type="text" className="kv-key-ro" readOnly value={`:${p.key}`} aria-label={`Path variable ${p.key}`} />
                    <input
                      type="text"
                      placeholder={p.description ?? 'value'}
                      value={p.value}
                      aria-label={`Value for ${p.key}`}
                      onChange={(e) => {
                        const next = [...request.pathParams!];
                        next[idx] = { ...p, value: e.target.value };
                        onUpdateRequest({ ...request, pathParams: next });
                      }}
                    />
                  </div>
                ))}
                {request.queryParams.length > 0 && <div className="kv-title">Query parameters</div>}
              </div>
            )}
            {request.queryParams.map((param, idx) => (
              <div key={idx} className="kv-row">
                <input
                  type="checkbox"
                  checked={param.enabled}
                  onChange={(e) => {
                    const next = [...request.queryParams];
                    next[idx] = { ...param, enabled: e.target.checked };
                    onUpdateRequest({ ...request, queryParams: next });
                  }}
                  title="Enable/disable parameter"
                />
                <input
                  type="text"
                  placeholder="Key"
                  value={param.key}
                  onChange={(e) => {
                    const next = [...request.queryParams];
                    next[idx] = { ...param, key: e.target.value };
                    onUpdateRequest({ ...request, queryParams: next });
                  }}
                />
                <input
                  type="text"
                  placeholder={param.description ?? 'Value'}
                  title={param.description}
                  value={param.value}
                  onChange={(e) => {
                    const next = [...request.queryParams];
                    next[idx] = { ...param, value: e.target.value };
                    onUpdateRequest({ ...request, queryParams: next });
                  }}
                />
                <button
                  className="link row-del"
                  onClick={() => {
                    const next = request.queryParams.filter((_, i) => i !== idx);
                    onUpdateRequest({ ...request, queryParams: next });
                  }}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="add-row-btn"
              onClick={() => {
                onUpdateRequest({
                  ...request,
                  queryParams: [...request.queryParams, { key: '', value: '', enabled: true }],
                });
              }}
            >
              + Add Query Param
            </button>
          </div>
        )}

        {/* HEADERS TAB */}
        {reqTab === 'headers' && (
          <div className="headers-tab">
            {request.headers.map((h, idx) => (
              <div key={idx} className="kv-row">
                <input
                  type="checkbox"
                  checked={h.enabled}
                  onChange={(e) => {
                    const next = [...request.headers];
                    next[idx] = { ...h, enabled: e.target.checked };
                    onUpdateRequest({ ...request, headers: next });
                  }}
                  title="Enable/disable header"
                />
                <input
                  type="text"
                  placeholder="Header Name"
                  value={h.key}
                  onChange={(e) => {
                    const next = [...request.headers];
                    next[idx] = { ...h, key: e.target.value };
                    onUpdateRequest({ ...request, headers: next });
                  }}
                />
                <input
                  type="text"
                  placeholder="Value"
                  value={h.value}
                  onChange={(e) => {
                    const next = [...request.headers];
                    next[idx] = { ...h, value: e.target.value };
                    onUpdateRequest({ ...request, headers: next });
                  }}
                />
                <button
                  className="link row-del"
                  onClick={() => {
                    const next = request.headers.filter((_, i) => i !== idx);
                    onUpdateRequest({ ...request, headers: next });
                  }}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="headers-actions">
              <button
                className="add-row-btn"
                onClick={() => {
                  onUpdateRequest({
                    ...request,
                    headers: [...request.headers, { key: '', value: '', enabled: true }],
                  });
                }}
              >
                + Add Header
              </button>
              <button
                className="link"
                onClick={() => {
                  const hasJson = request.headers.some((h) => h.key.toLowerCase() === 'content-type');
                  if (!hasJson) {
                    onUpdateRequest({
                      ...request,
                      headers: [...request.headers, { key: 'Content-Type', value: 'application/json', enabled: true }],
                    });
                  }
                }}
              >
                + JSON Content-Type
              </button>
            </div>
          </div>
        )}

        {/* AUTH TAB */}
        {reqTab === 'auth' && (
          <div className="auth-tab">
            <div className="auth-row">
              <label htmlFor="auth-type-select">Type:</label>
              <select
                id="auth-type-select"
                value={request.auth.type}
                onChange={(e) => onUpdateRequest({ ...request, auth: { ...request.auth, type: e.target.value as any } })}
              >
                <option value="none">No Auth</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic Auth</option>
              </select>
            </div>
            {request.auth.type === 'bearer' && (
              <div className="auth-row">
                <label htmlFor="bearer-token-input">Token:</label>
                <input
                  id="bearer-token-input"
                  type="password"
                  placeholder="Bearer token or {{token}}"
                  value={request.auth.token ?? ''}
                  onChange={(e) => onUpdateRequest({ ...request, auth: { ...request.auth, token: e.target.value } })}
                />
              </div>
            )}
            {request.auth.type === 'basic' && (
              <>
                <div className="auth-row">
                  <label htmlFor="basic-user-input">User:</label>
                  <input
                    id="basic-user-input"
                    type="text"
                    placeholder="Username"
                    value={request.auth.username ?? ''}
                    onChange={(e) => onUpdateRequest({ ...request, auth: { ...request.auth, username: e.target.value } })}
                  />
                </div>
                <div className="auth-row">
                  <label htmlFor="basic-pass-input">Pass:</label>
                  <input
                    id="basic-pass-input"
                    type="password"
                    placeholder="Password"
                    value={request.auth.password ?? ''}
                    onChange={(e) => onUpdateRequest({ ...request, auth: { ...request.auth, password: e.target.value } })}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* BODY TAB */}
        {reqTab === 'body' && (
          <div className="body-tab">
            <div className="body-header">
              <label>
                <input
                  type="radio"
                  name="bodyType"
                  checked={request.body.type === 'none'}
                  onChange={() => onUpdateRequest({ ...request, body: { ...request.body, type: 'none' } })}
                />
                none
              </label>
              <label>
                <input
                  type="radio"
                  name="bodyType"
                  checked={request.body.type === 'json'}
                  onChange={() => onUpdateRequest({ ...request, body: { ...request.body, type: 'json' } })}
                />
                JSON
              </label>
              <label>
                <input
                  type="radio"
                  name="bodyType"
                  checked={request.body.type === 'raw'}
                  onChange={() => onUpdateRequest({ ...request, body: { ...request.body, type: 'raw' } })}
                />
                raw
              </label>
              {request.body.type === 'json' && (
                <>
                  <button className="link" onClick={formatJsonBody} title="Pretty-print and repair the JSON (Shift+Alt+F)">
                    Format
                  </button>
                  <label title="Format automatically when you paste JSON or leave the editor">
                    <input type="checkbox" checked={autoFormat} onChange={(e) => setAutoFormat(e.target.checked)} />
                    auto-format
                  </label>
                </>
              )}
            </div>
            {request.body.type !== 'none' && (
              <CodeEditor
                ref={bodyRef}
                value={request.body.content}
                onChange={(v) => setBody(v)}
                language={request.body.type === 'json' ? 'json' : 'text'}
                errorLine={jsonStatus && !jsonStatus.ok ? jsonStatus.line : undefined}
                ariaLabel="Request body"
                placeholder={request.body.type === 'json' ? '{\n  "key": "value"\n}\n\nPaste JSON or a JS object — it is formatted automatically.\nCtrl+Enter sends.' : 'Request body text…'}
                onKeyDown={onBodyKeyDown}
                onPaste={onBodyPaste}
                onBlur={onBodyBlur}
              />
            )}
            {jsonStatus?.ok && <div className="body-ok-hint">✓ Valid JSON{!jsonStatus.strictOk ? ' (will be cleaned up automatically)' : ''}</div>}
            {jsonStatus && !jsonStatus.ok && (
              <div className="body-error-hint">
                ⚠️ {jsonStatus.error}
                {jsonStatus.line ? ` — line ${jsonStatus.line}, column ${jsonStatus.column}` : ''}
              </div>
            )}
          </div>
        )}
      </div>

      </div>

      {/* Response Section */}
      <div className="response-section">
        <h4>Response</h4>
        {isExecuting && (
          <div className="executing-banner">
            <span className="spinner" aria-hidden="true">
              ⏳
            </span>{' '}
            Sending request…
          </div>
        )}

        {!isExecuting && !response && <div className="hint">No response yet. Click &quot;Send&quot; to execute the request.</div>}

        {!isExecuting && response && (
          <div className="response-card">
            {/* Status & Metrics Bar */}
            <div className="response-metrics">
              <span
                className={`status-pill ${
                  response.status >= 200 && response.status < 300
                    ? 'status-2xx'
                    : response.status >= 300 && response.status < 400
                    ? 'status-3xx'
                    : response.status >= 400 && response.status < 500
                    ? 'status-4xx'
                    : 'status-5xx'
                }`}
              >
                {response.status ? `${response.status} ${response.statusText}` : response.statusText}
              </span>
              <span className="metric-pill">⏱️ {response.durationMs} ms</span>
              <span className="metric-pill">📦 {(response.sizeBytes / 1024).toFixed(1)} KB</span>
              <button className="link" onClick={copyResponse} title="Copy response body">
                Copy
              </button>
            </div>

            {response.error && (
              <div className="banner error" role="alert">
                <b>Request Error:</b> {response.error}
              </div>
            )}

            {response.truncated && (
              <div className="banner warn">⚠️ Response exceeded 2MB limit and was truncated for performance.</div>
            )}

            {/* Response tabs: Body | Headers */}
            <div className="res-tabs">
              <button className={`tab-btn ${resTab === 'body' ? 'active' : ''}`} onClick={() => setResTab('body')}>
                Body
              </button>
              <button className={`tab-btn ${resTab === 'headers' ? 'active' : ''}`} onClick={() => setResTab('headers')}>
                Headers ({Object.keys(response.headers).length})
              </button>
            </div>

            {resTab === 'body' && (
              <div className="code-viewer" aria-label="Response body">
                {response.body && <pre className="code-gutter-text" aria-hidden="true">{Array.from({ length: prettyResponse.text.split('\n').length }, (_, i) => i + 1).join('\n')}</pre>}
                <pre className="response-pre">
                  <code>
                    {response.body ? <HighlightedCode text={prettyResponse.text} language={prettyResponse.json ? 'json' : 'text'} /> : response.error ? '' : '(Empty response)'}
                  </code>
                </pre>
              </div>
            )}

            {resTab === 'headers' && (
              <div className="res-headers-table">
                {Object.entries(response.headers).map(([k, v]) => (
                  <div key={k} className="res-header-row">
                    <span className="res-header-key">{k}:</span>
                    <span className="res-header-val">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

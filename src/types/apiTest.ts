import { z } from 'zod';

export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export const KeyValueParamSchema = z.object({
  id: z.string().optional(),
  key: z.string(),
  value: z.string(),
  enabled: z.boolean().default(true),
  description: z.string().optional(),
});
export type KeyValueParam = z.infer<typeof KeyValueParamSchema>;

export const AuthConfigSchema = z.object({
  type: z.enum(['none', 'bearer', 'basic']),
  token: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

export const RequestBodySchema = z.object({
  type: z.enum(['none', 'json', 'raw']),
  content: z.string().default(''),
});
export type RequestBody = z.infer<typeof RequestBodySchema>;

export const ApiRequestSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  method: HttpMethodSchema.default('GET'),
  url: z.string(),
  queryParams: z.array(KeyValueParamSchema).default([]),
  /** Values for `:name` segments of the URL path (key = name without the colon). */
  pathParams: z.array(KeyValueParamSchema).optional(),
  headers: z.array(KeyValueParamSchema).default([]),
  auth: AuthConfigSchema.default({ type: 'none' }),
  body: RequestBodySchema.default({ type: 'none', content: '' }),
  timeoutMs: z.number().int().min(100).max(120_000).default(30_000),
  endpointId: z.string().optional(),
});
export type ApiRequest = z.infer<typeof ApiRequestSchema>;

export const ApiResponseSchema = z.object({
  requestId: z.string(),
  status: z.number(),
  statusText: z.string(),
  durationMs: z.number(),
  sizeBytes: z.number(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
  isJson: z.boolean(),
  truncated: z.boolean(),
  error: z.string().optional(),
  timing: z.object({
    start: z.number(),
    end: z.number(),
  }),
  traceId: z.string().optional(),
});
export type ApiResponse = z.infer<typeof ApiResponseSchema>;

export const EnvironmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  variables: z.record(z.string(), z.string()),
});
export type Environment = z.infer<typeof EnvironmentSchema>;

export const RequestHistoryItemSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  request: ApiRequestSchema,
  responseSummary: z.object({
    status: z.number(),
    statusText: z.string(),
    durationMs: z.number(),
    error: z.string().optional(),
  }),
});
export type RequestHistoryItem = z.infer<typeof RequestHistoryItemSchema>;

/** Substitutes {{variable}} placeholders with values from variables dictionary */
export function substituteVariables(text: string, variables: Record<string, string> = {}): string {
  if (!text || typeof text !== 'string') return text ?? '';
  return text.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (match, varName) => {
    if (Object.prototype.hasOwnProperty.call(variables, varName)) {
      return variables[varName];
    }
    return match;
  });
}

/** Resolves the complete URL with variable substitution and query parameters */
export function resolveRequestUrl(urlInput: string, queryParams: ApiRequest['queryParams'] = [], variables: Record<string, string> = {}, pathParams: ApiRequest['queryParams'] = []): string {
  let resolvedUrl = substituteVariables(urlInput.trim(), variables);

  // If URL has no scheme, prepend http:// or baseUrl from variables
  if (!/^https?:\/\//i.test(resolvedUrl)) {
    const baseUrl = variables['baseUrl'] || variables['BASE_URL'] || 'http://localhost:3000';
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const cleanPath = resolvedUrl.startsWith('/') ? resolvedUrl : `/${resolvedUrl}`;
    resolvedUrl = `${cleanBase}${cleanPath}`;
  }

  const parsed = new URL(resolvedUrl);

  // Fill `:name` path segments from the path variables that have a value; unfilled ones stay visible as `:name`
  const values = new Map(pathParams.filter((p) => p.enabled !== false && p.key.trim() && (p.value ?? '').trim() !== '').map((p) => [p.key.trim(), substituteVariables(p.value, variables).trim()]));
  if (values.size) {
    parsed.pathname = parsed.pathname
      .split('/')
      .map((seg) => {
        const m = /^:(\w+)\??$/.exec(seg);
        return m && values.has(m[1]) ? encodeURIComponent(values.get(m[1])!) : seg;
      })
      .join('/');
  }

  // Append enabled query parameters
  for (const param of queryParams) {
    if (param.enabled && param.key && param.key.trim()) {
      const key = substituteVariables(param.key.trim(), variables);
      const val = substituteVariables(param.value ?? '', variables);
      parsed.searchParams.append(key, val);
    }
  }

  return parsed.toString();
}

/** Prepares headers with variable substitution and authentication */
export function resolveHeaders(request: ApiRequest, variables: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const h of request.headers || []) {
    if (h.enabled && h.key && h.key.trim()) {
      const key = substituteVariables(h.key.trim(), variables);
      const val = substituteVariables(h.value ?? '', variables);
      headers[key] = val;
    }
  }

  // Handle Auth
  if (request.auth) {
    if (request.auth.type === 'bearer' && request.auth.token) {
      const token = substituteVariables(request.auth.token.trim(), variables);
      headers['Authorization'] = `Bearer ${token}`;
    } else if (request.auth.type === 'basic' && request.auth.username) {
      const user = substituteVariables(request.auth.username, variables);
      const pass = substituteVariables(request.auth.password ?? '', variables);
      const encoded = btoa(`${user}:${pass}`);
      headers['Authorization'] = `Basic ${encoded}`;
    }
  }

  // Handle JSON content-type default
  if (request.body && request.body.type === 'json') {
    const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
    if (!hasContentType) {
      headers['Content-Type'] = 'application/json';
    }
  }

  return headers;
}

/** Formats a shell-safe cURL command */
export function generateCurlCommand(request: ApiRequest, variables: Record<string, string> = {}): string {
  try {
    const url = resolveRequestUrl(request.url, request.queryParams, variables, request.pathParams);
    const headers = resolveHeaders(request, variables);
    const parts: string[] = ['curl', '-X', request.method];

    for (const [k, v] of Object.entries(headers)) {
      parts.push('-H', `"${k}: ${v.replace(/"/g, '\\"')}"`);
    }

    if (request.body && request.body.type !== 'none' && request.body.content) {
      const bodyContent = substituteVariables(request.body.content, variables);
      parts.push('-d', JSON.stringify(bodyContent));
    }

    parts.push(`"${url}"`);
    return parts.join(' ');
  } catch (e) {
    return `# Failed to generate cURL: ${(e as Error).message}`;
  }
}

/**
 * What the code says an endpoint accepts: path params, query params and body fields. Extracted statically (DTO classes,
 * `req.body.x` usage, validators, zod schemas, client calls) and used to pre-fill the API tester. Pure; no DOM/VS Code.
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';

export interface FieldSchema {
  name: string;
  type: FieldType;
  required: boolean;
  /** Nested fields when type is `object`, or the element's fields when type is `array` of objects. */
  fields?: FieldSchema[];
  /** Element type when type is `array`. */
  items?: FieldType;
  enumValues?: (string | number)[];
  example?: string | number | boolean;
}

export interface RequestSchema {
  pathParams: FieldSchema[];
  query: FieldSchema[];
  body: FieldSchema[];
  /** Human-readable evidence, e.g. "CreateUserDto (src/users/dto.ts)" or "req.body usage". */
  sources: string[];
}

export const emptySchema = (): RequestSchema => ({ pathParams: [], query: [], body: [], sources: [] });

export const MAX_SCHEMA_DEPTH = 3;
export const MAX_FIELDS_PER_LEVEL = 80;
const MAX_SERIALIZED = 40_000;

export function pathParamNames(path: string): string[] {
  const names: string[] = [];
  for (const seg of path.split('/')) {
    const m = /^:(\w+)\??$/.exec(seg) ?? /^\*(\w+)$/.exec(seg);
    if (m) names.push(m[1]);
  }
  return names;
}

const RANK: Record<FieldType, number> = { unknown: 0, object: 1, array: 1, string: 2, number: 2, boolean: 2 };

/** Union of two field lists by name; the more specific type wins and a field is required if either source says so. */
export function mergeFields(a: FieldSchema[], b: FieldSchema[]): FieldSchema[] {
  const out = new Map<string, FieldSchema>();
  for (const f of [...a, ...b]) {
    const prev = out.get(f.name);
    if (!prev) {
      out.set(f.name, { ...f });
      continue;
    }
    const best = RANK[f.type] > RANK[prev.type] || (f.fields && !prev.fields) ? f : prev;
    out.set(f.name, {
      ...best,
      required: prev.required || f.required,
      fields: prev.fields && f.fields ? mergeFields(prev.fields, f.fields) : (best.fields ?? prev.fields ?? f.fields),
      enumValues: best.enumValues ?? prev.enumValues ?? f.enumValues,
      example: best.example ?? prev.example ?? f.example,
    });
  }
  return [...out.values()].slice(0, MAX_FIELDS_PER_LEVEL);
}

export function mergeSchemas(...schemas: (RequestSchema | undefined)[]): RequestSchema {
  const out = emptySchema();
  for (const s of schemas) {
    if (!s) continue;
    out.pathParams = mergeFields(out.pathParams, s.pathParams);
    out.query = mergeFields(out.query, s.query);
    out.body = mergeFields(out.body, s.body);
    for (const src of s.sources) if (!out.sources.includes(src)) out.sources.push(src);
  }
  return out;
}

export const isEmptySchema = (s: RequestSchema): boolean => !s.pathParams.length && !s.query.length && !s.body.length;

/** Compact JSON for graph node metadata; null when empty or implausibly large. */
export function serializeSchema(s: RequestSchema): string | null {
  if (isEmptySchema(s)) return null;
  const text = JSON.stringify(s);
  return text.length > MAX_SERIALIZED ? null : text;
}

export function parseRequestSchema(text: unknown): RequestSchema | undefined {
  if (typeof text !== 'string' || !text) return undefined;
  try {
    const v = JSON.parse(text) as Partial<RequestSchema>;
    if (!v || !Array.isArray(v.pathParams) || !Array.isArray(v.query) || !Array.isArray(v.body)) return undefined;
    return { pathParams: v.pathParams, query: v.query, body: v.body, sources: Array.isArray(v.sources) ? v.sources : [] };
  } catch {
    return undefined;
  }
}

/** A value to start from: example, first enum value, or an empty value of the right type. */
export function placeholderValue(f: FieldSchema): unknown {
  if (f.example !== undefined) return f.example;
  if (f.enumValues?.length) return f.enumValues[0];
  switch (f.type) {
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return f.fields?.length ? [bodyTemplate(f.fields)] : [];
    case 'object':
      return f.fields?.length ? bodyTemplate(f.fields) : {};
    default:
      return '';
  }
}

/** JSON body skeleton with every known field present and an empty value of the right type. */
export function bodyTemplate(fields: FieldSchema[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f.name] = placeholderValue(f);
  return out;
}

/** "string · required", "number[] · optional", "one of: a, b" — shown next to a pre-filled row. */
export function describeField(f: FieldSchema): string {
  const type = f.type === 'array' ? `${f.items ?? 'unknown'}[]` : f.type;
  const parts = [type, f.required ? 'required' : 'optional'];
  if (f.enumValues?.length) parts.push(`one of: ${f.enumValues.slice(0, 6).join(', ')}${f.enumValues.length > 6 ? ', …' : ''}`);
  return parts.join(' · ');
}

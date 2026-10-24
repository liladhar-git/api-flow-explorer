/**
 * Nothing that looks like a credential may reach the graph, cache or exports. Source snippets (call text, hole
 * expressions, evidence) are quoted from user code, so every string in the extracted facts passes through here.
 */
// Quantifiers are bounded on purpose: unbounded `[\w-]*` on both sides of an alternation backtracks quadratically,
// which would let a hostile repository hang the analyzer with one long string literal.
const PATTERNS: [RegExp, string][] = [
  [/(\/\/)[^/@\s:'"`]{1,200}:[^/@\s'"`]{1,200}@/g, '$1***@'],
  [/([?&;](?:[\w-]{0,30}(?:key|token|secret|password|passwd|pwd|auth|signature|credential)[\w-]{0,30})=)[^&#\s'"`]{1,500}/gi, '$1***'],
  [/\bsk_(?:live|test)_[A-Za-z0-9]{8,200}/g, '***'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '***'],
  [/\beyJ[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{5,2000}/g, '***'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,200}/g, '***'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,200}/g, '***'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{10,500}/g, '$1 ***'],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, to] of PATTERNS) out = out.replace(re, to);
  return out;
}

/** Redacts every string value in a JSON-like structure (in place for objects/arrays; returns the same reference). */
export function redactDeep<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return redact(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = walk(v[i]);
      return v;
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) o[k] = walk(o[k]);
      return o;
    }
    return v;
  };
  return walk(value) as T;
}

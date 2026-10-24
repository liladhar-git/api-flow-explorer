import type { StaticString, StrPart, HolePart } from '../types/analyzer';

/** Path segment of a route pattern or of a request URL. */
export type PathSeg =
  | { t: 'lit'; v: string }
  | { t: 'param'; name: string; optional?: boolean }
  /** Hole covering only part of a segment (e.g. `/files/${name}.json`) — only comparable to route params. */
  | { t: 'partial'; name: string; lit?: string }
  | { t: 'wild'; name?: string; min: 0 | 1 };

/**
 * Replaces parameter holes with the call site's argument strings. Arguments live in the *caller's* parameter space
 * (they may hold the caller's own parameter holes, e.g. a recursive wrapper passing `url` along), so they are copied
 * as-is, never substituted again. An argument we could not evaluate becomes a dynamic (`expr`) hole.
 */
export function substitute(parts: StaticString, args: (StaticString | null | undefined)[]): StaticString {
  const out: StrPart[] = [];
  for (const p of parts) {
    if (typeof p !== 'string' && p.reason === 'param' && p.param !== undefined) {
      const a = args[p.param];
      if (a) out.push(...a);
      else out.push({ ...p, reason: 'expr', param: undefined });
      continue;
    }
    out.push(p);
  }
  const merged: StrPart[] = [];
  for (const p of out) {
    if (typeof p === 'string' && typeof merged[merged.length - 1] === 'string') merged[merged.length - 1] = (merged[merged.length - 1] as string) + p;
    else merged.push(p);
  }
  return merged;
}

export function normalizePath(p: string): string {
  let out = p.split('?')[0].split('#')[0];
  if (!out.startsWith('/')) out = '/' + out;
  out = out.replace(/\/{2,}/g, '/');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

export function joinPaths(...parts: string[]): string {
  const joined = parts.filter((p) => p !== '' && p !== '/').join('/');
  return normalizePath(joined === '' ? '/' : joined);
}

/** Parses a normalized route pattern ("/users/:id", "/files/*", "/docs/[...slug]" already converted by adapters). */
export function parsePattern(path: string): PathSeg[] {
  const segs = normalizePath(path).split('/').filter(Boolean);
  return segs.map((s): PathSeg => {
    if (s === '*' || s === '(.*)') return { t: 'wild', min: 0 };
    if (s.startsWith('*')) return { t: 'wild', name: s.slice(1), min: 1 };
    if (s.startsWith(':')) {
      const optional = s.endsWith('?');
      return { t: 'param', name: s.slice(1).replace(/[?+*]$/, ''), optional };
    }
    return { t: 'lit', v: s };
  });
}

const HOLE = '\u0001';
const QUERY_NAME = /^(query|qs|querystring|querystr|search|searchparams|params|queryparams|suffix)$/i;

export interface ResolvedUrl {
  /** Normalized path with `:name` segments for holes. */
  path: string;
  segments: PathSeg[];
  origin?: string;
  /** The URL begins with an unresolved base (env var / expression) that we could not see. */
  baseUnknown: boolean;
  baseReason?: string;
  /** Number of holes that became dynamic path segments. */
  dynamicSegments: number;
  partialSegments: number;
  /** An env fallback value was used because the variable is not configured. */
  usedFallback: boolean;
  /** Unresolved parameter holes remain (wrapper function parameters). */
  paramHoles: HolePart[];
  /** Whole url could not be interpreted at all (e.g. only a hole). */
  opaque: boolean;
}

function holeName(h: HolePart): string {
  const m = /([A-Za-z_$][\w$]*)\W*$/.exec(h.hole);
  return m ? m[1] : 'param';
}

/** Flattens parts into text with hole markers, substituting configured env values. */
function flatten(parts: StaticString, env: Record<string, string>, holes: HolePart[], state: { usedFallback: boolean }): string {
  let out = '';
  for (const part of parts as StrPart[]) {
    if (typeof part === 'string') {
      out += part;
      continue;
    }
    if (part.reason === 'env' && part.env && env[part.env] !== undefined) {
      out += env[part.env];
      continue;
    }
    if (part.reason === 'env' && part.fallback) {
      state.usedFallback = true;
      out += flatten(part.fallback, env, holes, state);
      continue;
    }
    holes.push(part);
    out += HOLE + (holes.length - 1) + HOLE;
  }
  return out;
}

export function resolveUrl(parts: StaticString, env: Record<string, string> = {}): ResolvedUrl {
  const holes: HolePart[] = [];
  const state = { usedFallback: false };
  let text = flatten(parts, env, holes, state);
  const result: ResolvedUrl = { path: '/', segments: [], baseUnknown: false, dynamicSegments: 0, partialSegments: 0, usedFallback: state.usedFallback, paramHoles: holes.filter((h) => h.reason === 'param'), opaque: false };

  // origin
  const abs = /^([a-zA-Z][a-zA-Z0-9+.-]*:)?\/\/([^/?#]*)/.exec(text);
  if (abs && !abs[2].includes(HOLE)) {
    result.origin = (abs[1] ?? '') + '//' + abs[2];
    text = text.slice(abs[0].length);
  } else if (abs) {
    result.baseUnknown = true;
    result.baseReason = 'URL host is built from an unresolved expression';
    text = text.slice(abs[0].length);
  } else {
    const lead = new RegExp(`^${HOLE}(\\d+)${HOLE}`).exec(text);
    if (lead && (text.length === lead[0].length || text[lead[0].length] === '/')) {
      const h = holes[Number(lead[1])];
      result.baseUnknown = true;
      result.baseReason = h.reason === 'env' ? `base URL comes from ${h.env ? `environment variable ${h.env}` : h.hole}, which is not configured (set apiFlowExplorer.baseUrls)` : `URL starts with unresolved expression \`${h.hole}\``;
      text = text.slice(lead[0].length);
    }
  }

  text = text.split('?')[0].split('#')[0];
  // nothing but an unresolved expression: the whole URL is dynamic, not just its base
  if (text === '' && !result.origin && holes.length > 0) result.opaque = true;
  const segs = normalizePath(text).split('/').filter(Boolean);
  for (const s of segs) {
    const whole = new RegExp(`^${HOLE}(\\d+)${HOLE}$`).exec(s);
    if (whole) {
      result.segments.push({ t: 'param', name: holeName(holes[Number(whole[1])]) });
      result.dynamicSegments++;
    } else if (s.includes(HOLE)) {
      const m = new RegExp(`${HOLE}(\\d+)${HOLE}`).exec(s)!;
      result.segments.push({ t: 'partial', name: holeName(holes[Number(m[1])]), lit: s.replace(new RegExp(`${HOLE}\\d+${HOLE}`, 'g'), '') });
      result.partialSegments++;
    } else {
      result.segments.push({ t: 'lit', v: s });
    }
  }
  // `/video-assets${query}`: a query-string suffix glued to the last segment is not part of the path
  const last = result.segments[result.segments.length - 1];
  if (last?.t === 'partial' && QUERY_NAME.test(last.name)) {
    result.partialSegments--;
    if (last.lit) result.segments[result.segments.length - 1] = { t: 'lit', v: last.lit };
    else result.segments.pop();
  }
  result.path = '/' + result.segments.map((s) => (s.t === 'lit' ? s.v : s.t === 'param' || s.t === 'partial' ? ':' + s.name : '*')).join('/');
  if (result.path === '/') result.path = '/';
  return result;
}

export interface SegMatch {
  matched: boolean;
  /** Higher = more literal agreement. */
  specificity: number;
  /** Request-side dynamic segments aligned with route params. */
  dynamic: boolean;
}

/** Aligns a request path with a route pattern. Request holes only match route params/wildcards, never literals. */
export function matchSegments(req: PathSeg[], route: PathSeg[]): SegMatch {
  let best: SegMatch = { matched: false, specificity: -1, dynamic: false };
  const go = (i: number, j: number, spec: number, dyn: boolean): void => {
    if (j === route.length) {
      if (i === req.length && spec > best.specificity) best = { matched: true, specificity: spec, dynamic: dyn };
      return;
    }
    const r = route[j];
    if (r.t === 'wild') {
      for (let k = i + r.min; k <= req.length; k++) go(k, j + 1, spec, dyn || req.slice(i, k).some((s) => s.t !== 'lit'));
      return;
    }
    if (r.t === 'param' && r.optional) go(i, j + 1, spec, dyn);
    if (i >= req.length) return;
    const q = req[i];
    if (r.t === 'lit') {
      if (q.t === 'lit' && q.v === r.v) go(i + 1, j + 1, spec + 2, dyn);
    } else if (r.t === 'param') {
      go(i + 1, j + 1, spec + 1, dyn || q.t !== 'lit');
    }
  };
  go(0, 0, 0, false);
  return best;
}

export function staticToText(parts: StaticString): string {
  return parts.map((p) => (typeof p === 'string' ? p : '${' + p.hole + '}')).join('');
}

/**
 * Route definitions (Express/Nest) → normalized pattern. Unlike request URLs, `?` is meaningful here
 * (optional params) and holes of any kind become `:name` params.
 */
export function routePathFromParts(parts: StaticString): { path: string; holes: number } {
  let out = '';
  let holes = 0;
  for (const p of parts as StrPart[]) {
    if (typeof p === 'string') out += p;
    else {
      holes++;
      out += ':' + holeName(p);
    }
  }
  out = out.replace(/:(\w+)\([^)]*\)/g, ':$1');
  const segs = out.split('/').filter(Boolean);
  return { path: '/' + segs.join('/'), holes };
}

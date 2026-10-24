import type { CallFact, RequestFact, StaticString, StrPart } from '../types/analyzer';
import type { GraphNode } from '../types/graph';
import { HTTP_METHODS } from '../types/graph';
import { externalId, unknownId } from '../graph/ids';
import type { LinkContext } from './adapters/shared/adapter';
import { Assessment } from './confidence';
import { matchSegments, parsePattern, resolveUrl, staticToText, substitute, type PathSeg } from './pathUtils';

interface ConcreteRequest {
  fact: RequestFact;
  /** Location used for the node and evidence (the call site for wrapper expansions). */
  path: string;
  line: number;
  column: number;
  id: string;
  owner: string;
  via?: string;
  /** Distinguishes expansions of one wrapper request. */
  url: StaticString;
}

export interface EndpointEntry {
  node: GraphNode;
  method: string;
  segments: PathSeg[];
}

const MAX_WRAPPER_DEPTH = 3;

/**
 * Segment trie over endpoint patterns. It only *narrows* candidates (literal/param/wildcard structure); the actual
 * match and its specificity are still decided by `matchSegments`, so the two cannot disagree. Without it every
 * request is compared with every endpoint, which dominated link time on large projects.
 */
export class EndpointIndex {
  private readonly root: TrieNode = newTrieNode();
  /** Patterns with optional params are matched against every request (rare). */
  private readonly flexible: EndpointEntry[] = [];
  private readonly byLastLiteral = new Map<string, EndpointEntry[]>();

  constructor(readonly all: EndpointEntry[]) {
    for (const e of all) {
      if (e.segments.some((s) => s.t === 'param' && s.optional)) {
        this.flexible.push(e);
        continue;
      }
      let node = this.root;
      let ended = true;
      for (const seg of e.segments) {
        if (seg.t === 'wild') {
          node.wild.push(e);
          ended = false;
          break;
        }
        node = seg.t === 'lit' ? (node.lit.get(seg.v) ?? node.lit.set(seg.v, newTrieNode()).get(seg.v)!) : (node.param ??= newTrieNode());
      }
      if (ended) node.ends.push(e);
      const last = e.segments[e.segments.length - 1];
      if (last?.t === 'lit') (this.byLastLiteral.get(last.v) ?? this.byLastLiteral.set(last.v, []).get(last.v)!).push(e);
    }
  }

  candidates(req: PathSeg[]): EndpointEntry[] {
    const out = new Set<EndpointEntry>(this.flexible);
    const visit = (node: TrieNode, i: number): void => {
      for (const e of node.wild) out.add(e);
      if (i === req.length) {
        for (const e of node.ends) out.add(e);
        return;
      }
      const seg = req[i];
      if (seg.t === 'lit') {
        const child = node.lit.get(seg.v);
        if (child) visit(child, i + 1);
      }
      if (node.param) visit(node.param, i + 1);
    };
    visit(this.root, 0);
    return [...out];
  }

  /** Endpoints whose pattern ends with the request's last literal segment: used for "possible missing prefix" hints. */
  tailCandidates(req: PathSeg[]): EndpointEntry[] {
    const last = req[req.length - 1];
    return last?.t === 'lit' ? (this.byLastLiteral.get(last.v) ?? []) : [];
  }
}

interface TrieNode {
  lit: Map<string, TrieNode>;
  param?: TrieNode;
  ends: EndpointEntry[];
  wild: EndpointEntry[];
}
const newTrieNode = (): TrieNode => ({ lit: new Map(), ends: [], wild: [] });
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

function hostOf(origin: string): string {
  return origin.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, '').replace(/^\/\//, '').toLowerCase();
}

function paramIndexes(parts: StaticString | undefined): number[] {
  return (parts ?? []).filter((p): p is Exclude<StrPart, string> => typeof p !== 'string' && p.reason === 'param' && p.param !== undefined).map((p) => p.param!);
}

function dynamicize(parts: StaticString): StaticString {
  return parts.map((p) => (typeof p !== 'string' && p.reason === 'param' ? { ...p, reason: 'expr' as const, param: undefined } : p));
}

function methodOf(parts: StaticString | undefined, defaultMethod: string | undefined): string | undefined {
  if (!parts) return defaultMethod;
  if (parts.length === 1 && typeof parts[0] === 'string') {
    const m = parts[0].toUpperCase();
    return (HTTP_METHODS as readonly string[]).includes(m) ? m : undefined;
  }
  return undefined;
}

/**
 * Links request call sites to API endpoints using evidence only: method, normalized path and resolvable base URL.
 * Names or file locations are never used. Dynamic or ambiguous matches are marked inferred; failures are kept as
 * unresolved edges with the reason attached.
 */
export function linkRequests(link: LinkContext): void {
  const { graph, facts, options, diagnostics } = link;

  // --- endpoints -----------------------------------------------------------
  const endpoints: EndpointEntry[] = graph
    .allNodes()
    .filter((n) => n.kind === 'api-endpoint')
    .map((node) => ({ node, method: String(node.metadata.method ?? 'ALL'), segments: parsePattern(String(node.metadata.path ?? '/')) }));
  const index = new EndpointIndex(endpoints);

  // --- requests, including wrapper expansion ---------------------------------
  const callsByTarget = new Map<string, { call: CallFact; path: string }[]>();
  for (const f of facts.values()) {
    for (const c of f.calls) {
      if (!c.args) continue;
      let list = callsByTarget.get(c.to);
      if (!list) callsByTarget.set(c.to, (list = []));
      list.push({ call: c, path: f.path });
    }
  }

  const concrete: ConcreteRequest[] = [];
  const expand = (req: ConcreteRequest, depth: number, wrapperName?: string): void => {
    const idx = [...paramIndexes(req.url), ...paramIndexes(req.fact.base), ...paramIndexes(req.fact.method)];
    // A parameter only makes the function an API wrapper when some caller supplies a static value for it;
    // otherwise it is just a dynamic path segment (e.g. `fetch(`/users/${id}`)`).
    const callers = idx.length && depth < MAX_WRAPPER_DEPTH ? (callsByTarget.get(req.owner) ?? []).filter((c) => idx.some((i) => c.call.args?.[i])) : [];
    if (callers.length === 0) {
      if (idx.length) {
        const url = dynamicize(req.url);
        concrete.push({ ...req, url, fact: { ...req.fact, url, base: req.fact.base && dynamicize(req.fact.base), method: req.fact.method && dynamicize(req.fact.method) } });
      } else concrete.push(req);
      return;
    }
    for (const { call, path } of callers) {
      const args = call.args ?? [];
      const url = substitute(req.url, args);
      const base = req.fact.base ? substitute(req.fact.base, args) : undefined;
      const method = req.fact.method ? substitute(req.fact.method, args) : undefined;
      const next: ConcreteRequest = {
        fact: { ...req.fact, url, base, method },
        path,
        line: call.line,
        column: 1,
        id: `${req.id}@${path}:${call.line}`,
        owner: call.from,
        via: wrapperName ?? req.owner.split('#')[1],
        url,
      };
      expand(next, depth + 1, next.via);
    }
  };
  for (const f of facts.values()) {
    for (const r of f.requests) {
      expand({ fact: r, path: f.path, line: r.line, column: r.column, id: r.id, owner: r.owner, url: r.url }, 0);
    }
  }

  const configuredHosts = new Set<string>();
  for (const v of Object.values(options.baseUrls)) {
    const m = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/.exec(v);
    if (m) configuredHosts.add(m[1].toLowerCase());
  }

  const seenIds = new Set<string>();
  for (const req of concrete.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (seenIds.has(req.id)) continue;
    seenIds.add(req.id);
    if (!link.ensureSymbol(req.owner)) continue;

    const fullParts: StaticString = req.fact.base && !isAbsolute(req.url) ? [...req.fact.base, ...req.url] : req.url;
    const resolved = resolveUrl(fullParts, options.baseUrls);
    const method = methodOf(req.fact.method, req.fact.library === 'fetch' && !req.fact.method ? 'GET' : undefined);
    const displayUrl = staticToText(fullParts);
    const execution = req.fact.execution;

    const node: GraphNode = {
      id: req.id,
      kind: 'api-client',
      name: `${method ?? '?'} ${resolved.path === '/' && resolved.opaque ? displayUrl : resolved.path}`,
      path: req.path,
      startLine: req.line,
      startColumn: req.column,
      metadata: {
        method: method ?? 'UNKNOWN',
        library: req.fact.library,
        rawUrl: displayUrl.slice(0, 200),
        normalizedPath: resolved.path,
        execution,
        ...(req.via ? { viaWrapper: req.via } : {}),
        ...(resolved.origin ? { origin: resolved.origin } : {}),
      },
    };
    graph.addNode(node);
    graph.addEdge({
      source: req.owner,
      target: node.id,
      kind: 'calls',
      evidence: { path: req.path, line: req.line, explanation: req.via ? `calls API wrapper ${req.via}, which issues ${req.fact.library} request` : `issues ${req.fact.library} request` },
      confidence: 'high',
      resolution: 'resolved',
    });

    const evidence = (explanation: string) => ({ path: req.path, line: req.line, explanation });

    // external absolute URL
    if (resolved.origin) {
      const host = hostOf(resolved.origin);
      const hostName = host.split(':')[0];
      const internal = LOCAL_HOSTS.has(hostName) || configuredHosts.has(host);
      if (!internal) {
        const id = externalId(host);
        graph.addNode({ id, kind: 'external-api', name: host, metadata: { origin: resolved.origin } });
        graph.addEdge({ source: node.id, target: id, kind: 'http-request', evidence: evidence(`absolute URL targets external host ${host}`), confidence: 'high', resolution: 'resolved' });
        continue;
      }
    }

    // unresolved wrapper parameter or opaque URL
    if (resolved.paramHoles.length > 0 || resolved.opaque) {
      const why = resolved.paramHoles.length > 0
        ? `URL derives from parameter \`${resolved.paramHoles[0].hole}\` of a wrapper function and no call site with a static URL was found`
        : `URL is a dynamic expression (${displayUrl.slice(0, 80)}) that cannot be evaluated statically`;
      unresolved(link, node, req, why, 'dynamic-url', method ?? 'UNKNOWN', 'dynamic', evidence(why));
      continue;
    }

    // matching
    const candidates = index
      .candidates(resolved.segments)
      .map((e) => ({ e, m: matchSegments(resolved.segments, e.segments) }))
      .filter(({ e, m }) => m.matched && (!method || e.method === method || e.method === 'ALL'));
    if (candidates.length === 0) {
      const suffix = index
        .tailCandidates(resolved.segments)
        .filter((e) => e.segments.length > resolved.segments.length && matchSegments(resolved.segments, e.segments.slice(e.segments.length - resolved.segments.length)).matched);
      const hint = suffix.length ? ` Routes with the same ending exist (${suffix.slice(0, 3).map((e) => `${e.method} ${e.node.metadata.path}`).join(', ')}) — a prefix may be missing from the request URL or base URL.` : '';
      const why = resolved.baseUnknown
        ? `${resolved.baseReason}; remaining path ${method ?? ''} ${resolved.path} matches no known route.${hint}`
        : `no endpoint matches ${method ?? 'any method'} ${resolved.path} (${endpoints.length} endpoint(s) indexed).${hint}`;
      unresolved(link, node, req, why, resolved.baseUnknown ? 'unknown-base-url' : 'unmatched-request', method ?? 'UNKNOWN', resolved.path, evidence(why));
      continue;
    }

    let bestSpec = -1;
    for (const c of candidates) if (c.m.specificity > bestSpec) bestSpec = c.m.specificity;
    const best = candidates.filter((c) => c.m.specificity === bestSpec);
    const ambiguous = best.length > 1;
    for (const { e, m } of best) {
      const a = new Assessment();
      if (resolved.baseUnknown) a.downgrade('low', 'inferred', `${resolved.baseReason}; matched on the remaining path only`);
      if (resolved.usedFallback) a.downgrade('medium', 'inferred', 'base URL uses the default of an unconfigured environment variable');
      if (m.dynamic || resolved.dynamicSegments > 0) a.downgrade('medium', 'inferred', 'dynamic path segment(s) aligned with route parameters');
      if (resolved.partialSegments > 0) a.downgrade('low', 'inferred', 'path segment is partially dynamic');
      if (!method) a.downgrade('low', 'inferred', 'HTTP method could not be determined statically');
      if (e.node.metadata.methodInferred) a.downgrade('medium', 'inferred', 'endpoint method inferred from handler body');
      if (ambiguous) a.downgrade('low', 'inferred', `ambiguous: ${best.length} routes match equally`);
      graph.addEdge({
        source: node.id,
        target: e.node.id,
        kind: 'http-request',
        evidence: evidence(`${method ?? '?'} ${resolved.path} matches ${e.method} ${e.node.metadata.path}`),
        confidence: a.confidence,
        resolution: a.resolution,
        reason: a.reason,
      });
    }
    if (ambiguous) {
      diagnostics.push({ severity: 'warning', code: 'ambiguous-match', message: `${method ?? '?'} ${resolved.path} matches ${best.length} routes equally`, path: req.path, line: req.line });
    }
  }
}

function isAbsolute(parts: StaticString): boolean {
  const first = parts[0];
  return typeof first === 'string' ? /^([a-zA-Z][a-zA-Z0-9+.-]*:)?\/\//.test(first) : first?.reason === 'env';
}

function unresolved(
  link: LinkContext,
  node: GraphNode,
  req: ConcreteRequest,
  reason: string,
  code: 'dynamic-url' | 'unknown-base-url' | 'unmatched-request',
  method: string,
  pathText: string,
  evidence: { path: string; line: number; explanation: string },
): void {
  const id = code === 'dynamic-url' ? unknownId(`request:${req.path}:${req.line}`) : unknownId(`request:${method} ${pathText}`);
  link.graph.addNode({
    id,
    kind: 'unknown',
    name: code === 'dynamic-url' ? 'Dynamic request target' : `No matching route: ${method} ${pathText}`,
    metadata: { reason: code },
  });
  link.graph.addEdge({ source: node.id, target: id, kind: 'http-request', evidence, confidence: 'low', resolution: 'unresolved', reason });
  link.diagnostics.push({ severity: code === 'unmatched-request' ? 'info' : 'warning', code, message: reason, path: req.path, line: req.line });
}

import type { LinkContext } from './adapters/shared/adapter';
import { symId } from '../graph/ids';

const names = (list: (string | undefined)[]): string[] => [...new Set(list.filter((x): x is string => !!x))].sort();

/**
 * Facts the Endpoint Details panel shows, gathered from the finished graph: the handler and its controller, the guards,
 * interceptors and middleware on the route, the Nest module that registers the controller, and the author's description.
 */
export function enrichEndpoints(link: LinkContext): void {
  const { graph } = link;
  const edgesBySource = new Map<string, ReturnType<typeof graph.allEdges>>();
  for (const e of graph.allEdges()) (edgesBySource.get(e.source) ?? edgesBySource.set(e.source, []).get(e.source)!).push(e);

  for (const node of graph.allNodes()) {
    if (node.kind !== 'api-endpoint') continue;
    const out = edgesBySource.get(node.id) ?? [];
    const handlerNode = out
      .filter((e) => e.kind === 'handles-route')
      .map((e) => graph.getNode(e.target))
      .find((n) => n && n.kind !== 'unknown');
    const target = (kind: string) => out.filter((e) => e.kind === kind).map((e) => graph.getNode(e.target));
    const meta: Record<string, string | string[]> = {};

    if (handlerNode) {
      const qualified = handlerNode.qualifiedName ?? handlerNode.name;
      const dot = qualified.lastIndexOf('.');
      meta.handler = handlerNode.metadata.anonymous ? 'inline handler' : dot >= 0 ? qualified.slice(dot + 1) : qualified;
      if (!node.metadata.controller && dot > 0) meta.controller = qualified.slice(0, dot);
      if (typeof handlerNode.metadata.description === 'string') meta.description = handlerNode.metadata.description;
      // Nest: the module that registers the controller class
      const cls = dot > 0 && handlerNode.path ? graph.getNode(symId(handlerNode.path, qualified.slice(0, dot))) : undefined;
      const modules = cls?.metadata.registeredIn;
      if (Array.isArray(modules) && modules.length) meta.module = modules.map(String).join(', ');
    }
    const guards = names(target('uses-guard').map((n) => n?.name));
    const interceptors = names(target('uses-middleware').filter((n) => n?.kind === 'interceptor').map((n) => n?.name));
    const middleware = names(target('uses-middleware').filter((n) => n?.kind === 'middleware').map((n) => n?.name));
    if (guards.length) meta.guards = guards;
    if (interceptors.length) meta.interceptors = interceptors;
    if (middleware.length) meta.middleware = middleware;
    node.metadata = { ...node.metadata, ...meta };
  }
}

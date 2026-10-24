import type { Graph, GraphEdge, GraphNode, NodeKind } from '../types/graph';

const SHAPE: Record<NodeKind, [string, string]> = {
  'frontend-page': ['([', '])'],
  'frontend-component': ['([', '])'],
  'api-client': ['([', '])'],
  'api-endpoint': ['{{', '}}'],
  route: ['{{', '}}'],
  middleware: ['[', ']'],
  guard: ['[', ']'],
  interceptor: ['[', ']'],
  controller: ['[', ']'],
  service: ['[', ']'],
  function: ['[', ']'],
  repository: ['[', ']'],
  model: ['[(', ')]'],
  database: ['[(', ')]'],
  queue: ['[(', ')]'],
  'external-api': ['[/', '/]'],
  unknown: ['>', ']'],
};

const CLASS_OF: Partial<Record<NodeKind, string>> = {
  'frontend-page': 'frontend', 'frontend-component': 'frontend', 'api-client': 'frontend', 'api-endpoint': 'api', route: 'api',
  model: 'data', database: 'data', queue: 'data', 'external-api': 'external', unknown: 'unknown',
};

/** Mermaid labels are quoted; strip characters that break the parser. */
function esc(text: string): string {
  return text.replace(/"/g, '#quot;').replace(/[\r\n]+/g, ' ').replace(/[<>]/g, (c) => (c === '<' ? '#lt;' : '#gt;')).slice(0, 90);
}

function label(n: GraphNode): string {
  const loc = n.path ? `<br/>${esc(n.path)}:${n.startLine ?? 1}` : '';
  return `${esc(n.kind === 'api-endpoint' ? n.name : n.name)}${loc}`;
}

export interface MermaidOptions {
  direction?: 'LR' | 'TB';
}

/** Flowchart of the given nodes and every edge between them. Output order is deterministic. */
export function exportMermaid(graph: Graph, nodeIds: string[], opts: MermaidOptions = {}): string {
  const wanted = new Set(nodeIds);
  const nodes = graph.nodes.filter((n) => wanted.has(n.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  const alias = new Map(nodes.map((n, i) => [n.id, `n${i}`]));
  const edges: GraphEdge[] = graph.edges.filter((e) => alias.has(e.source) && alias.has(e.target)).sort((a, b) => (a.id < b.id ? -1 : 1));

  const out: string[] = [`flowchart ${opts.direction ?? 'LR'}`];
  for (const n of nodes) {
    const [open, close] = SHAPE[n.kind];
    out.push(`  ${alias.get(n.id)}${open}"${label(n)}"${close}`);
  }
  const unresolvedLinks: number[] = [];
  edges.forEach((e, i) => {
    const text = esc(e.resolution === 'resolved' ? `${e.kind}` : `${e.kind} · ${e.confidence} ${e.resolution}`);
    const arrow = e.resolution === 'resolved' ? '-->' : '-.->';
    out.push(`  ${alias.get(e.source)} ${arrow}|"${text}"| ${alias.get(e.target)}`);
    if (e.resolution === 'unresolved') unresolvedLinks.push(i);
  });
  const byClass = new Map<string, string[]>();
  for (const n of nodes) {
    const c = CLASS_OF[n.kind];
    if (c) (byClass.get(c) ?? byClass.set(c, []).get(c)!).push(alias.get(n.id)!);
  }
  const colours: Record<string, string> = {
    frontend: 'stroke:#3794ff', api: 'stroke:#4caf50', data: 'stroke:#d18616', external: 'stroke:#cca700,stroke-dasharray: 4 3', unknown: 'stroke:#f14c4c,stroke-dasharray: 2 4',
  };
  for (const [c, ids] of [...byClass].sort()) {
    out.push(`  classDef ${c} ${colours[c]}`);
    out.push(`  class ${ids.join(',')} ${c}`);
  }
  if (unresolvedLinks.length) out.push(`  linkStyle ${unresolvedLinks.join(',')} stroke:#f14c4c,stroke-dasharray: 2 4`);
  return out.join('\n') + '\n';
}

export function wrapMermaidMarkdown(diagram: string, title: string): string {
  return `# ${title}\n\n\`\`\`mermaid\n${diagram}\`\`\`\n`;
}

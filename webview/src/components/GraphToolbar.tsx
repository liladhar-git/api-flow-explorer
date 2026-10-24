import { useEffect, useRef, useState } from 'react';
import { IconChevronDown, IconExport, IconFit, IconLayout, IconScan } from '../shared/icons';
import type { LayoutDirection } from '../types/view';

export interface ToolbarProps {
  scanning: boolean;
  hasGraph: boolean;
  direction: LayoutDirection;
  depth: number;
  openOnClick: boolean;
  onScan(): void;
  onFit(): void;
  onResetLayout?(): void;
  onDirection(d: LayoutDirection): void;
  onDepth(d: number): void;
  onOpenOnClick(v: boolean): void;
  onExportMermaid(): void;
  onExport?(action: 'markdown' | 'json'): void;
}

/** Export ▾ menu: the visible flow as Mermaid, or the whole analysis as Markdown docs / JSON. */
function ExportMenu({ disabled, onMermaid, onExport }: { disabled: boolean; onMermaid(): void; onExport?(a: 'markdown' | 'json'): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="tb-menu" ref={root}>
      <button className="tb-btn" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)} title="Export the flow or the analysis">
        <IconExport /> Export <IconChevronDown />
      </button>
      {open && (
        <div className="tb-menu-pop" role="menu">
          <button role="menuitem" onClick={pick(onMermaid)} title="Copy the visible flow as a Mermaid diagram">Mermaid diagram (visible flow)</button>
          <button role="menuitem" onClick={pick(() => onExport?.('markdown'))} title="Endpoint documentation for the whole analysis">Markdown documentation</button>
          <button role="menuitem" onClick={pick(() => onExport?.('json'))} title="The complete normalized graph">Graph as JSON</button>
        </div>
      )}
    </div>
  );
}

export function GraphToolbar(p: ToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Graph toolbar">
      <button className="tb-primary" onClick={p.onScan} disabled={p.scanning} title="Analyze the workspace">
        <IconScan /> {p.scanning ? 'Scanning…' : 'Scan Workspace'}
      </button>
      <button className="tb-btn" onClick={p.onFit} disabled={!p.hasGraph} title="Fit the graph to the view">
        <IconFit /> Fit Graph
      </button>
      {p.onResetLayout && (
        <button className="tb-btn" onClick={p.onResetLayout} disabled={!p.hasGraph} title="Reset node positions to a clean automatic layout">
          <IconLayout /> Auto Layout
        </button>
      )}
      <select className="tb-select" aria-label="Layout direction" value={p.direction} onChange={(e) => p.onDirection(e.target.value as LayoutDirection)}>
        <option value="LR">Left → Right</option>
        <option value="TB">Top → Bottom</option>
      </select>
      <label className="tb-select-label" title="How many hops to show around an endpoint">
        Depth
        <select className="tb-select" aria-label="Depth" value={p.depth} onChange={(e) => p.onDepth(Number(e.target.value))}>
          {[1, 2, 3, 4, 5, 6].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </label>
      <label className="tb-check" title="Open the source file at the node's line when a node is clicked">
        <input type="checkbox" checked={p.openOnClick} onChange={(e) => p.onOpenOnClick(e.target.checked)} />
        Open source on click
      </label>
      <ExportMenu disabled={!p.hasGraph} onMermaid={p.onExportMermaid} onExport={p.onExport} />
    </div>
  );
}

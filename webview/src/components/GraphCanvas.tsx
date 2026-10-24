import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  ControlButton,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  type Edge,
  type NodeTypes,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from '../state/layout';
import { categoryOf, type Category, type GraphEdge, type GraphNode, type LayoutDirection, type Selection } from '../types/view';
import { IconLock } from '../shared/icons';
import { EDGE_LABEL } from '../state/trace';
import { GraphNodeComponent, type FlowNode } from './GraphNode';

const nodeTypes: NodeTypes = { graph: GraphNodeComponent };

export interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hidden: Record<string, { up: number; down: number }>;
  focusId?: string;
  direction: LayoutDirection;
  graphVersion: number;
  selection?: Selection;
  onSelect(selection: Selection | undefined): void;
  onNodeClick(nodeId: string): void;
  fitSignal: number;
  resetLayoutSignal?: number;
  /** Locked: nodes cannot be dragged and the view cannot be moved with the mouse. */
  locked?: boolean;
  onToggleLock?(): void;
}

const MINIMAP_COLOR: Record<Category, string> = {
  frontend: '#3794ff',
  api: '#89d185',
  backend: '#b180d7',
  data: '#d18616',
  external: '#cca700',
  unknown: '#f14c4c',
};

export function toFlow(
  props: Pick<GraphCanvasProps, 'nodes' | 'edges' | 'hidden' | 'focusId' | 'direction' | 'selection'>,
  userPositions?: Map<string, { x: number; y: number }>
): { nodes: FlowNode[]; edges: Edge[] } {
  const dagrePositions = layoutGraph(props.nodes, props.edges, props.direction);
  const nodes: FlowNode[] = props.nodes.map((n) => {
    const pos = userPositions?.get(n.id) ?? dagrePositions.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      type: 'graph',
      position: pos,
      initialWidth: NODE_WIDTH,
      initialHeight: NODE_HEIGHT,
      selected: props.selection?.type === 'node' && props.selection.id === n.id,
      data: {
        node: n,
        hiddenUp: props.hidden[n.id]?.up ?? 0,
        hiddenDown: props.hidden[n.id]?.down ?? 0,
        isFocus: n.id === props.focusId,
        vertical: props.direction === 'TB',
      },
    };
  });
  const edges: Edge[] = props.edges.map((e) => {
    const unresolved = e.resolution === 'unresolved';
    const inferred = e.resolution === 'inferred';
    const color = unresolved
      ? 'var(--vscode-charts-red, #f14c4c)'
      : e.kind === 'http-request'
      ? 'var(--vscode-charts-blue, #3794ff)'
      : 'var(--vscode-editorWidget-border, #888)';
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: EDGE_LABEL[e.kind],
      selected: props.selection?.type === 'edge' && props.selection.id === e.id,
      animated: e.kind === 'http-request' && !unresolved,
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: {
        stroke: color,
        strokeWidth: e.confidence === 'high' ? 2 : 1.4,
        strokeDasharray: unresolved ? '3 4' : inferred ? '7 4' : undefined,
        opacity: e.confidence === 'low' ? 0.7 : 1,
      },
      labelStyle: { fontSize: 11, fill: 'var(--vscode-foreground)', fontWeight: 600 },
      labelBgStyle: { fill: 'var(--vscode-editor-background, #1e1e1e)', fillOpacity: 1, stroke: color, strokeWidth: 1 },
      labelBgPadding: [8, 4] as [number, number],
      labelBgBorderRadius: 10,
      data: { confidence: e.confidence, resolution: e.resolution },
    };
  });
  return { nodes, edges };
}

function Inner(props: GraphCanvasProps) {
  const { fitView } = useReactFlow();
  const userPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  const initialFlow = useMemo(() => toFlow(props, userPositions.current), []);
  const [nodes, setNodes] = useState<FlowNode[]>(initialFlow.nodes);
  const [edges, setEdges] = useState<Edge[]>(initialFlow.edges);

  const prevFocusRef = useRef(props.focusId);
  const prevDirectionRef = useRef(props.direction);
  const prevVersionRef = useRef(props.graphVersion);
  const prevResetSignalRef = useRef(props.resetLayoutSignal ?? 0);

  useEffect(() => {
    const resetLayout =
      prevFocusRef.current !== props.focusId ||
      prevDirectionRef.current !== props.direction ||
      prevVersionRef.current !== props.graphVersion ||
      prevResetSignalRef.current !== (props.resetLayoutSignal ?? 0);

    if (resetLayout) {
      userPositions.current.clear();
      prevFocusRef.current = props.focusId;
      prevDirectionRef.current = props.direction;
      prevVersionRef.current = props.graphVersion;
      prevResetSignalRef.current = props.resetLayoutSignal ?? 0;
    }

    const flow = toFlow(props, userPositions.current);
    setNodes(flow.nodes);
    setEdges(flow.edges);
  }, [
    props.nodes,
    props.edges,
    props.hidden,
    props.focusId,
    props.direction,
    props.selection,
    props.graphVersion,
    props.resetLayoutSignal,
  ]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        userPositions.current.set(c.id, c.position);
      }
    }
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  // New graph or layout: stay readable (min zoom) and centred on the flow; users can zoom out or press "Fit view".
  useEffect(() => {
    const t = setTimeout(() => void fitView({ padding: 0.12, duration: 200, minZoom: 0.7, maxZoom: 1 }), 30);
    return () => clearTimeout(t);
  }, [props.graphVersion, props.direction, props.resetLayoutSignal, fitView]);

  // Explicit "Fit view": show everything, however small
  useEffect(() => {
    if (props.fitSignal === 0) return;
    void fitView({ padding: 0.12, duration: 200, maxZoom: 1 });
  }, [props.fitSignal, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodesDraggable={!props.locked}
      panOnDrag={!props.locked}
      zoomOnScroll={!props.locked}
      zoomOnPinch={!props.locked}
      zoomOnDoubleClick={!props.locked}
      nodesConnectable={false}
      elementsSelectable={true}
      minZoom={0.05}
      maxZoom={2.5}
      onlyRenderVisibleElements
      colorMode="dark"
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, n) => {
        props.onSelect({ type: 'node', id: n.id });
        props.onNodeClick(n.id);
      }}
      onEdgeClick={(_, e) => props.onSelect({ type: 'edge', id: e.id })}
      onPaneClick={() => props.onSelect(undefined)}
    >
      <Background gap={20} />
      <Controls showInteractive={false} showFitView>
        {props.onToggleLock && (
          <ControlButton onClick={props.onToggleLock} aria-label={props.locked ? 'Unlock graph' : 'Lock graph'} title={props.locked ? 'Unlock graph (allow moving and zooming)' : 'Lock graph (no accidental moves)'}>
            <IconLock locked={!!props.locked} />
          </ControlButton>
        )}
      </Controls>
      <MiniMap
        pannable
        zoomable
        nodeStrokeWidth={3}
        nodeColor={(n) => MINIMAP_COLOR[categoryOf((n.data as FlowNode['data']).node)]}
      />
    </ReactFlow>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <div className="canvas" tabIndex={-1} aria-label="API Flow Graph">
      <ReactFlowProvider>
        <Inner {...props} />
      </ReactFlowProvider>
    </div>
  );
}

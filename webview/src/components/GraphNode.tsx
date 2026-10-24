import { createContext, memo, useContext } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { categoryOf, type GraphNode as CanonicalNode } from '../types/view';
import { CATEGORY_NAME, fileLabel, KIND_NAME, methodOf } from '../state/display';
import { CategoryIcon } from './CategoryIcon';

export interface FlowNodeData extends Record<string, unknown> {
  node: CanonicalNode;
  hiddenUp: number;
  hiddenDown: number;
  isFocus: boolean;
  vertical: boolean;
}
export type FlowNode = Node<FlowNodeData, 'graph'>;

export interface NodeActions {
  expand(nodeId: string, direction: 'upstream' | 'downstream'): void;
}
export const NodeActionsContext = createContext<NodeActions>({ expand: () => undefined });

function GraphNodeView({ data, selected }: NodeProps<FlowNode>) {
  const { node, hiddenUp, hiddenDown, isFocus, vertical } = data;
  const actions = useContext(NodeActionsContext);
  const category = categoryOf(node);
  const method = methodOf(node);
  const unresolved = node.kind === 'unknown';
  const kindName = KIND_NAME[node.kind] ?? node.kind;
  const location = fileLabel(node);

  return (
    <div
      className={`gnode cat-${category}${selected ? ' selected' : ''}${isFocus ? ' focus' : ''}${node.metadata.external ? ' external' : ''}${node.kind === 'api-endpoint' ? ' endpoint' : ''}`}
      title={`${CATEGORY_NAME[category]} · ${kindName}: ${node.qualifiedName ?? node.name}${location ? `\n${location}` : ''}\n(Drag to reposition)`}
      data-kind={node.kind}
    >
      <Handle type="target" position={vertical ? Position.Top : Position.Left} />
      <div className="gnode-icon" aria-hidden="true">
        <CategoryIcon category={category} />
      </div>
      <div className="gnode-main">
        <div className="gnode-head">
          {method && <span className={`af-badge m-${method}`}>{method}</span>}
          <span className="gnode-kind">{kindName}</span>
          {unresolved && <span className="badge-unresolved" title="Unresolved: see details for the reason">?</span>}
        </div>
        <div className="gnode-name" title={node.qualifiedName ?? node.name}>{node.name}</div>
        {location && <div className="gnode-file" title={location}>{location}</div>}
      </div>
      {hiddenUp > 0 && (
        <button
          className="expand up nodrag"
          title={`Show ${hiddenUp} more upstream relationship(s)`}
          onClick={(e) => {
            e.stopPropagation();
            actions.expand(node.id, 'upstream');
          }}
        >
          {vertical ? '▴' : '◂'} {hiddenUp}
        </button>
      )}
      {hiddenDown > 0 && (
        <button
          className="expand down nodrag"
          title={`Show ${hiddenDown} more downstream relationship(s)`}
          onClick={(e) => {
            e.stopPropagation();
            actions.expand(node.id, 'downstream');
          }}
        >
          {hiddenDown} {vertical ? '▾' : '▸'}
        </button>
      )}
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} />
    </div>
  );
}

export const GraphNodeComponent = memo(GraphNodeView);

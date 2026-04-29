import React, { useCallback } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
} from "reactflow";

type WorkflowEditorCanvasProps = {
  nodes: Node[];
  onNodesChange: (changes: any) => void;
  onEdgesChange: (changes: any) => void;
  onConnect: (connection: Connection) => void;
  onNodeClick: NodeMouseHandler;
  onNodeContextMenu: (e: React.MouseEvent, node: Node) => void;
  onEdgeClick: (e: React.MouseEvent, edge: Edge) => void;
  onPaneClick: () => void;
  nodeTypes: NodeTypes;
  lastStepErrors: Record<string, Record<string, string>> | null;
  addNode: (stepType: string, position?: { x: number; y: number }, connectFrom?: { sourceNodeId: string; sourceHandle?: string }) => void;
  edgesWithSelection: Edge[];
  onConnectEndRequest: (position: { x: number; y: number }, sourceNodeId: string, sourceHandle?: string) => void;
  onPaneContextMenuRequest: (position: { x: number; y: number }) => void;
};

export default function WorkflowEditorCanvas({
  nodes,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onNodeContextMenu,
  onEdgeClick,
  onPaneClick,
  nodeTypes,
  lastStepErrors,
  addNode,
  edgesWithSelection,
  onConnectEndRequest,
  onPaneContextMenuRequest,
}: WorkflowEditorCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();
  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onPaneContextMenuRequest(position);
    },
    [screenToFlowPosition, onPaneContextMenuRequest]
  );
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState?: unknown) => {
      const state = connectionState as { isValid?: boolean; fromNode?: { id: string }; handleId?: string | null } | undefined;
      if (!state || state.isValid || !state.fromNode) return;
      const clientX = "changedTouches" in event ? (event as TouchEvent).changedTouches[0]?.clientX : (event as MouseEvent).clientX;
      const clientY = "changedTouches" in event ? (event as TouchEvent).changedTouches[0]?.clientY : (event as MouseEvent).clientY;
      if (clientX == null || clientY == null) return;
      const position = screenToFlowPosition({ x: clientX, y: clientY });
      onConnectEndRequest(position, state.fromNode.id, state.handleId ?? undefined);
    },
    [screenToFlowPosition, onConnectEndRequest]
  );
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const stepType = e.dataTransfer.getData("application/x-workflow-step-type");
      if (!stepType) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(stepType, position);
    },
    [addNode, screenToFlowPosition]
  );
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  return (
    <ReactFlow
      nodes={nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          hasError: Boolean(lastStepErrors?.[n.id] && Object.keys(lastStepErrors[n.id]).length > 0),
        },
      }))}
      edges={edgesWithSelection}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={onNodeClick}
      onNodeContextMenu={onNodeContextMenu}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      onPaneContextMenu={onPaneContextMenu}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onConnectEnd={onConnectEnd}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={{ type: "smoothstep" }}
      fitView
    >
      <Background />
      <Controls />
      <MiniMap style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 8 }} nodeColor={() => "#374151"} />
    </ReactFlow>
  );
}

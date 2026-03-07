import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeMouseHandler
} from "reactflow";
import dagre from "dagre";
import "reactflow/dist/style.css";
import type { WorkflowDetail } from "../api/workflow";
import IfNode from "./IfNode";
import DefaultNode from "./DefaultNode";
import React, { useMemo } from "react";

const nodeTypes = {
  ifNode: IfNode,
  defaultNode: DefaultNode
};

type StepState = {
  stepId: string;
  status: "pending" | "running" | "completed" | "failed" | "retrying";
  retryCount: number;
};

type Step = WorkflowDetail["steps"][0];

type Props = {
  steps: Step[];
  onNodeClick: (step: Step) => void;
  stepStates?: StepState[];
};

const nodeWidth = 180;
const nodeHeight = 60;

function getLayoutedElements(steps: Step[], stepStates?: StepState[]) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  // soldan sağa layout
  dagreGraph.setGraph({
    rankdir: "LR",
    nodesep: 80,
    ranksep: 120
  });

  // node'ları ekle
  steps.forEach(step => {
    dagreGraph.setNode(step.id, {
      width: nodeWidth,
      height: nodeHeight
    });
  });

  // edge'leri ekle
  steps.forEach(step => {
    step.dependsOn?.forEach(dep => {
      dagreGraph.setEdge(dep, step.id);
    });
  });

  dagre.layout(dagreGraph);
  
  const nodes: Node[] = steps.map(step => {
    const nodeWithPosition = dagreGraph.node(step.id);

    const state = stepStates?.find(s => s.stepId === step.id);
    return {
      id: step.id,
      type:
        step.type === "if"
          ? "ifNode"
          : "defaultNode",  
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2
      },
      data: { label: `${step.id} (${step.type})`, status: state?.status, retryCount: state?.retryCount ?? 0 },
     
    };
  });

  const edges: Edge[] = [];

  steps.forEach(step => {
    step.dependsOn?.forEach(dep => {
      edges.push({
        id: `${dep}->${step.id}`,
        source: dep,
        target: step.id,
        animated: true,
        style: { stroke: "#6b7280" }
      });
    });
  });

  return { nodes, edges };
}

function WorkflowGraph({ steps, onNodeClick, stepStates }: Props) {
  const { nodes, edges } = useMemo(() => {
    return getLayoutedElements(steps, stepStates);
  }, [steps, stepStates]);

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    const step = steps.find(s => s.id === node.id);
    if (step) {
      onNodeClick(step);
    }
  };
  console.log("WorkflowGraph rendered with steps:", nodes, "and edges:", edges);
  return (
    <div style={{ height: 500 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
      >
        <Background />
        <Controls />
        <MiniMap
          style={{
            background: "#0b1220",
            border: "1px solid #1f2937",
            borderRadius: 8
          }}
          maskColor="rgba(0,0,0,0.4)"
          nodeColor={() => "#374151"}
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}

export default React.memo(WorkflowGraph);
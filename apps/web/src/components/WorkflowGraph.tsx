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
  status: "pending" | "running" | "completed" | "failed" | "retrying" | "skipped" | "cancelled";
  retryCount: number;
  iteration?: number;
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

  // edge'leri ekle (dependsOn + IF then/else)
  steps.forEach(step => {
    step.dependsOn?.forEach(dep => {
      dagreGraph.setEdge(dep, step.id);
    });
  });
  steps.forEach(step => {
    if (step.type === "if") {
      const thenGoto = step.params?.thenGoto;
      const elseGoto = step.params?.elseGoto;
      if (typeof thenGoto === "string" && thenGoto.trim() && steps.some(s => s.id === thenGoto)) {
        dagreGraph.setEdge(step.id, thenGoto);
      }
      if (typeof elseGoto === "string" && elseGoto.trim() && steps.some(s => s.id === elseGoto)) {
        dagreGraph.setEdge(step.id, elseGoto);
      }
    }
  });

  dagre.layout(dagreGraph);

  const nodes: Node[] = steps.map(step => {
    const nodeWithPosition = dagreGraph.node(step.id);

    const statesForStep = stepStates?.filter(s => s.stepId === step.id) ?? [];
    const primaryState = statesForStep.length === 1
      ? statesForStep[0]
      : statesForStep.find(s => s.status === "running" || s.status === "pending")
        ?? statesForStep.find(s => s.status === "completed")
        ?? statesForStep.find(s => s.status === "failed")
        ?? statesForStep[0];
    const iterations = statesForStep.map(s => s.iteration ?? 0).sort((a, b) => a - b);

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
      data: {
        label: `${step.id} (${step.type})`,
        stepId: step.id,
        stepType: step.type,
        params: step.params,
        status: primaryState?.status,
        retryCount: primaryState?.retryCount ?? 0,
        iteration: primaryState?.iteration,
        iterations: iterations.length > 0 ? iterations : undefined,
      },
    };
  });

  const edges: Edge[] = [];
  const ifBranchTargets = new Set<string>();
  steps.forEach(s => {
    if (s.type === "if") {
      const t = s.params?.thenGoto;
      const e = s.params?.elseGoto;
      if (typeof t === "string" && t.trim()) ifBranchTargets.add(t);
      if (typeof e === "string" && e.trim()) ifBranchTargets.add(e);
    }
  });

  steps.forEach(step => {
    step.dependsOn?.forEach(dep => {
      const sourceStep = steps.find(s => s.id === dep);
      const isIfBranch = sourceStep?.type === "if" && ifBranchTargets.has(step.id);
      if (isIfBranch) return;
      edges.push({
        id: `${dep}->${step.id}`,
        source: dep,
        target: step.id,
        animated: true,
        style: { stroke: "#6b7280" }
      });
    });
  });
  steps.forEach(step => {
    if (step.type === "if") {
      const thenGoto = step.params?.thenGoto;
      const elseGoto = step.params?.elseGoto;
      if (typeof thenGoto === "string" && thenGoto.trim() && steps.some(s => s.id === thenGoto)) {
        edges.push({
          id: `${step.id}-true->${thenGoto}`,
          source: step.id,
          target: thenGoto,
          sourceHandle: "true",
          label: "true",
          labelStyle: { fill: "#e5e7eb", fontWeight: 600 },
          labelBgStyle: { fill: "#1f2937" },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
          animated: true,
          style: { stroke: "#6b7280" }
        });
      }
      if (typeof elseGoto === "string" && elseGoto.trim() && steps.some(s => s.id === elseGoto)) {
        edges.push({
          id: `${step.id}-false->${elseGoto}`,
          source: step.id,
          target: elseGoto,
          sourceHandle: "false",
          label: "false",
          labelStyle: { fill: "#e5e7eb", fontWeight: 600 },
          labelBgStyle: { fill: "#1f2937" },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
          animated: true,
          style: { stroke: "#6b7280" }
        });
      }
    }
  });

  return { nodes, edges };
}

function getBaseLayout(steps: Step[]) {
  return getLayoutedElements(steps, undefined);
}

function WorkflowGraph({ steps, onNodeClick, stepStates }: Props) {
  const baseLayout = useMemo(() => getBaseLayout(steps), [steps]);

  const nodes = useMemo(() => {
    if (!stepStates || stepStates.length === 0) return baseLayout.nodes;
    const statesByStep = new Map<string, StepState[]>();
    for (const s of stepStates) {
      const list = statesByStep.get(s.stepId) ?? [];
      list.push(s);
      statesByStep.set(s.stepId, list);
    }
    return baseLayout.nodes.map(node => {
      const statesForStep = statesByStep.get(node.id) ?? [];
      const primaryState = statesForStep.length === 1
        ? statesForStep[0]
        : statesForStep.find(s => s.status === "running" || s.status === "pending")
          ?? statesForStep.find(s => s.status === "completed")
          ?? statesForStep.find(s => s.status === "failed")
          ?? statesForStep[0];
      const iterations = statesForStep.map(s => s.iteration ?? 0).sort((a, b) => a - b);
      return {
        ...node,
        data: {
          ...node.data,
          status: primaryState?.status,
          retryCount: primaryState?.retryCount ?? 0,
          iteration: primaryState?.iteration,
          iterations: iterations.length > 0 ? iterations : undefined,
        },
      };
    });
  }, [baseLayout.nodes, stepStates]);

  const edges = baseLayout.edges;

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    const step = steps.find(s => s.id === node.id);
    if (step) {
      onNodeClick(step);
    }
  };

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
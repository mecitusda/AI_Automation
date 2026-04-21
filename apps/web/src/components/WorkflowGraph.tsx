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
import {
  READONLY_DEFAULT_PLUGIN_HANDLES,
  READONLY_IF_HANDLES,
  resolveDependsOnSourceHandle,
  stepHasOutgoingErrorPort,
} from "../utils/workflowGraphEdges";

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
  loopProgressByStep?: Record<string, { current: number; total: number }>;
  /** Run detail: latest error text per stepId (execution view). */
  failureHintByStepId?: Record<string, string>;
};

const nodeWidth = 180;
const nodeHeight = 60;

function selectPrimaryStepState(statesForStep: StepState[]): { primary?: StepState; status?: string } {
  const hasSkipped = statesForStep.some((s) => s.status === "skipped");
  const primary = statesForStep.length === 1
    ? statesForStep[0]
    : statesForStep.find((s) => s.status === "running" || s.status === "pending" || s.status === "retrying")
      ?? statesForStep.find((s) => s.status === "failed")
      ?? statesForStep.find((s) => s.status === "completed")
      ?? statesForStep.find((s) => s.status === "skipped")
      ?? statesForStep[0];
  const status = (primary?.status === "completed" && hasSkipped) ? "partial" : primary?.status;
  return { primary, status };
}

function getLayoutedElements(
  steps: Step[],
  stepStates?: StepState[],
  loopProgressByStep?: Record<string, { current: number; total: number }>,
  failureHintByStepId?: Record<string, string>
) {
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
    const { primary: primaryState, status } = selectPrimaryStepState(statesForStep);
    const iterations = statesForStep.map(s => s.iteration ?? 0).sort((a, b) => a - b);

    const handles = step.type === "if" ? READONLY_IF_HANDLES : READONLY_DEFAULT_PLUGIN_HANDLES;

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
        handles,
        status,
        retryCount: primaryState?.retryCount ?? 0,
        iteration: primaryState?.iteration,
        iterations: iterations.length > 0 ? iterations : undefined,
        progressCurrent: step.type === "foreach" ? loopProgressByStep?.[step.id]?.current : undefined,
        progressTotal: step.type === "foreach" ? loopProgressByStep?.[step.id]?.total : undefined,
        failureHint: failureHintByStepId?.[step.id] ?? "",
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
    step.dependsOn?.forEach((dep, depIdx) => {
      const sourceStep = steps.find(s => s.id === dep);
      const isIfBranch = sourceStep?.type === "if" && ifBranchTargets.has(step.id);
      if (isIfBranch) return;
      const isErrorEdge = step.errorFrom === dep;
      const isSwitchBranch =
        step.branch != null &&
        String(step.branch) !== "" &&
        depIdx === 0 &&
        sourceStep?.type === "switch";
      const parentHasErrorPort = stepHasOutgoingErrorPort(steps, dep);
      const sourceHandle = resolveDependsOnSourceHandle({
        isErrorEdge,
        isSwitchBranch,
        branchHandle: isSwitchBranch ? String(step.branch) : undefined,
        sourceStepType: sourceStep?.type,
        parentHasErrorPort,
      });
      edges.push({
        id: `${dep}->${step.id}${isErrorEdge ? "-err" : ""}`,
        source: dep,
        target: step.id,
        ...(sourceHandle ? { sourceHandle } : {}),
        animated: true,
        ...(isErrorEdge
          ? {
              label: "error",
              labelStyle: { fill: "#fecaca", fontWeight: 600 },
              labelBgStyle: { fill: "#450a0a" },
              labelBgPadding: [4, 2] as [number, number],
              labelBgBorderRadius: 4,
              style: { stroke: "#ef4444" }
            }
          : { style: { stroke: "#6b7280" } })
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

function WorkflowGraph({ steps, onNodeClick, stepStates, loopProgressByStep, failureHintByStepId }: Props) {
  const baseLayout = useMemo(
    () => getLayoutedElements(steps, undefined, undefined, failureHintByStepId),
    [steps, failureHintByStepId]
  );

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
      const { primary: primaryState, status } = selectPrimaryStepState(statesForStep);
      const iterations = statesForStep.map(s => s.iteration ?? 0).sort((a, b) => a - b);
      return {
        ...node,
        data: {
          ...node.data,
          status,
          retryCount: primaryState?.retryCount ?? 0,
          iteration: primaryState?.iteration,
          iterations: iterations.length > 0 ? iterations : undefined,
          progressCurrent: (node.data as { stepType?: string }).stepType === "foreach"
            ? loopProgressByStep?.[node.id]?.current
            : undefined,
          progressTotal: (node.data as { stepType?: string }).stepType === "foreach"
            ? loopProgressByStep?.[node.id]?.total
            : undefined,
          failureHint: failureHintByStepId?.[node.id] ?? (node.data as { failureHint?: string }).failureHint ?? "",
        },
      };
    });
  }, [baseLayout.nodes, stepStates, loopProgressByStep, failureHintByStepId]);

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
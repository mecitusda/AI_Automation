import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type ReactFlowInstance
} from "reactflow";
import dagre from "dagre";
import "reactflow/dist/style.css";
import type { WorkflowDetail } from "../api/workflow";
import IfNode from "./IfNode";
import DefaultNode from "./DefaultNode";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  READONLY_DEFAULT_PLUGIN_HANDLES,
  READONLY_IF_HANDLES,
  resolveDependsOnSourceHandle,
  stepHasOutgoingErrorPort,
} from "../utils/workflowGraphEdges";

const NODE_TYPES = Object.freeze({
  ifNode: IfNode,
  defaultNode: DefaultNode
});

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
  steps: Step[]
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

type NodeData = Record<string, unknown>;

function buildNodeData(
  baseData: NodeData,
  statesForStep: StepState[],
  loopProgress: { current: number; total: number } | undefined,
  failureHint: string | undefined
): NodeData {
  const { primary: primaryState, status } = selectPrimaryStepState(statesForStep);
  const iterations = statesForStep.map((s) => s.iteration ?? 0).sort((a, b) => a - b);
  const stepType = (baseData as { stepType?: string }).stepType;
  return {
    ...baseData,
    status,
    retryCount: primaryState?.retryCount ?? 0,
    iteration: primaryState?.iteration,
    iterations: iterations.length > 0 ? iterations : undefined,
    progressCurrent: stepType === "foreach" ? loopProgress?.current : undefined,
    progressTotal: stepType === "foreach" ? loopProgress?.total : undefined,
    failureHint: failureHint ?? (baseData as { failureHint?: string }).failureHint ?? "",
  };
}

function shallowEqualData(a: NodeData, b: NodeData): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

function WorkflowGraph({ steps, onNodeClick, stepStates, loopProgressByStep, failureHintByStepId }: Props) {
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const nodeTypes = useMemo(() => NODE_TYPES, []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastStableLayoutRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const lastFittedSignatureRef = useRef<string>("");
  const debugRef = useRef({ emits: 0, fitCount: 0, lastNodeCount: -1, fallbackCount: 0 });
  const topologySignature = useMemo(
    () =>
      steps
        .map((s) => {
          const dependsOn = (s.dependsOn ?? []).join(",");
          const thenGoto = typeof s.params?.thenGoto === "string" ? s.params.thenGoto : "";
          const elseGoto = typeof s.params?.elseGoto === "string" ? s.params.elseGoto : "";
          return `${s.id}:${s.type}:${dependsOn}:${s.branch ?? ""}:${s.errorFrom ?? ""}:${thenGoto}:${elseGoto}`;
        })
        .join("|"),
    [steps]
  );

  const baseLayout = useMemo(() => {
    if (!Array.isArray(steps) || steps.length === 0) {
      if (debugRef.current.fallbackCount < 40) {
        debugRef.current.fallbackCount += 1;
        console.warn("[WorkflowGraphFallbackLayout]", {
          fallbackCount: debugRef.current.fallbackCount,
          cachedNodes: lastStableLayoutRef.current?.nodes.length ?? 0,
        });
      }
      return lastStableLayoutRef.current ?? { nodes: [], edges: [] };
    }
    const computed = getLayoutedElements(steps);
    if (computed.nodes.length > 0) {
      lastStableLayoutRef.current = computed;
    }
    return computed;
  }, [topologySignature]);

  // ReactFlow-managed state. We feed React Flow's internal store via
  // `setNodes`/`setEdges` so it doesn't have to re-sync its store from the
  // `nodes` prop on every parent render. Without this, fast socket updates
  // were causing brief reconciliation gaps that visually emptied the graph.
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Sync topology (positions / edges / node types) only when the topology
  // signature changes. Existing node data is preserved so we don't blink
  // status colors when only the layout was recomputed.
  useEffect(() => {
    if (baseLayout.nodes.length === 0) {
      // Don't blow away whatever ReactFlow already shows. Keeping the previous
      // nodes prevents the graph from flashing empty during transient empty
      // step arrays.
      return;
    }
    setEdges(baseLayout.edges);
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return baseLayout.nodes.map((layoutNode) => {
        const existing = prevById.get(layoutNode.id);
        if (!existing) return layoutNode;
        return {
          ...layoutNode,
          data: { ...layoutNode.data, ...existing.data },
        };
      });
    });
  }, [baseLayout.nodes, baseLayout.edges, setNodes, setEdges]);

  // Patch node `data` in place when step states / loop progress / failure
  // hints change. We only return a new node reference when its data actually
  // changed so ReactFlow can short-circuit unchanged nodes.
  useEffect(() => {
    setNodes((prev) => {
      if (prev.length === 0) return prev;
      const statesByStep = new Map<string, StepState[]>();
      for (const s of stepStates ?? []) {
        const list = statesByStep.get(s.stepId) ?? [];
        list.push(s);
        statesByStep.set(s.stepId, list);
      }
      let changed = false;
      const next = prev.map((node) => {
        const statesForStep = statesByStep.get(node.id) ?? [];
        const newData = buildNodeData(
          node.data as NodeData,
          statesForStep,
          loopProgressByStep?.[node.id],
          failureHintByStepId?.[node.id]
        );
        if (shallowEqualData(node.data as NodeData, newData)) return node;
        changed = true;
        return { ...node, data: newData };
      });
      return changed ? next : prev;
    });
  }, [stepStates, loopProgressByStep, failureHintByStepId, setNodes]);

  useEffect(() => {
    if (!rfInstance) return;
    if (!nodes.length) return;
    if (!topologySignature) return;
    if (lastFittedSignatureRef.current === topologySignature) return;
    lastFittedSignatureRef.current = topologySignature;
    if (!import.meta.env.PROD) {
      debugRef.current.fitCount += 1;
    }
    requestAnimationFrame(() => {
      rfInstance.fitView({ padding: 0.2 });
    });
  }, [rfInstance, topologySignature, nodes.length]);

  useEffect(() => {
    if (!rfInstance) return;
    if (!nodes.length) return;
    const el = containerRef.current;
    if (!el) return;
    let resizeFitRaf = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width < 50 || height < 50) return;
      if (resizeFitRaf) cancelAnimationFrame(resizeFitRaf);
      resizeFitRaf = requestAnimationFrame(() => {
        rfInstance.fitView({ padding: 0.2 });
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (resizeFitRaf) cancelAnimationFrame(resizeFitRaf);
    };
  }, [rfInstance, nodes.length]);

  useEffect(() => {
    if (import.meta.env.PROD) return;
    const dbg = debugRef.current;
    const nodeCount = nodes.length;
    if (dbg.lastNodeCount === nodeCount || dbg.emits >= 30) return;
    dbg.lastNodeCount = nodeCount;
    dbg.emits += 1;
    console.debug("[WorkflowGraphDebug]", {
      emit: dbg.emits,
      nodeCount,
      fitViewCount: dbg.fitCount
    });
  }, [nodes.length]);

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    const step = steps.find(s => s.id === node.id);
    if (step) {
      onNodeClick(step);
    }
  };

  return (
    <div ref={containerRef} style={{ height: 500 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={setRfInstance}
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
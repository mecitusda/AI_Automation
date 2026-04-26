import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeMouseHandler,
} from "reactflow";
import dagre from "dagre";
import "reactflow/dist/style.css";
import { fetchWorkflowDetail, updateWorkflow, startRun } from "../api/workflow";
import { fetchRuns } from "../api/run";
import type { WorkflowDetail, WorkflowTrigger } from "../api/workflow";
import { validateWorkflow } from "../utils/validateWorkflow";
import {
  isErrorOutputEdge,
  collectBranchWarnings,
  resolveDependsOnSourceHandle,
  stepHasOutgoingErrorPort,
  READONLY_DEFAULT_PLUGIN_HANDLES,
  READONLY_IF_HANDLES,
} from "../utils/workflowGraphEdges";
import { fetchPlugins } from "../api/plugins";
import type { PluginInfo, PluginHandles } from "../api/plugins";
import { getNodeTypesByCategory, nodeRegistry } from "../nodes";
import type { NodeTypeDef } from "../nodes";
import { NODE_CATEGORIES } from "../nodes";
import ParamsFallbackForm from "../nodes/forms/ParamsFallbackForm";
import IfNode from "../components/IfNode";
import DefaultNode from "../components/DefaultNode";
import StepEditModal, { type EditableStep } from "../components/StepEditModal";
import { WorkflowEditorContext } from "../contexts/WorkflowEditorContext";

const nodeTypes = {
  ifNode: IfNode,
  defaultNode: DefaultNode,
};

type EditorFlowInnerProps = {
  nodes: Node[];
  onNodesChange: (changes: any) => void;
  onEdgesChange: (changes: any) => void;
  onConnect: (connection: Connection) => void;
  onNodeClick: NodeMouseHandler;
  onNodeContextMenu: (e: React.MouseEvent, node: Node) => void;
  onEdgeClick: (e: React.MouseEvent, edge: Edge) => void;
  onPaneClick: () => void;
  nodeTypes: typeof nodeTypes;
  lastStepErrors: Record<string, Record<string, string>> | null;
  addNode: (stepType: string, position?: { x: number; y: number }, connectFrom?: { sourceNodeId: string; sourceHandle?: string }) => void;
  edgesWithSelection: Edge[];
  onConnectEndRequest: (position: { x: number; y: number }, sourceNodeId: string, sourceHandle?: string) => void;
  onPaneContextMenuRequest: (position: { x: number; y: number }) => void;
};

function EditorFlowInner({
  nodes,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onNodeContextMenu,
  onEdgeClick,
  onPaneClick,
  nodeTypes: nt,
  lastStepErrors,
  addNode,
  edgesWithSelection,
  onConnectEndRequest,
  onPaneContextMenuRequest,
}: EditorFlowInnerProps) {
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
      nodeTypes={nt}
      defaultEdgeOptions={{ type: "smoothstep" }}
      fitView
    >
      <Background />
      <Controls />
      <MiniMap style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 8 }} nodeColor={() => "#374151"} />
    </ReactFlow>
  );
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 72;

const DEFAULT_PARAMS: Record<string, Record<string, unknown>> = {
  http: { url: "", method: "GET" },
  log: { message: "" },
  ai: { prompt: "", model: "gpt-4", temperature: 0.7, maxTokens: 500 },
  openai: { prompt: "", model: "gpt-4", temperature: 0.7, maxTokens: 500 },
  delay: { ms: 1000 },
  foreach: { items: "{{ trigger.items }}" },
  if: { condition: "{{ trigger.flag }}", thenGoto: "", elseGoto: "" },
  email: { to: "", subject: "", body: "" },
  slack: { channel: "", text: "" },
  "db.set": { key: "", value: {} },
  "db.get": { key: "" },
  "db.delete": { key: "" },
  "db.query": { keyPrefix: "", limit: 50 },
};

function stepsToNodesAndEdges(steps: WorkflowDetail["steps"]): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: "LR", nodesep: 100, ranksep: 140 });

  steps.forEach((step) => {
    dagreGraph.setNode(step.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  steps.forEach((step) => {
    step.dependsOn?.forEach((dep) => dagreGraph.setEdge(dep, step.id));
  });
  steps.forEach((step) => {
    if (step.type === "if") {
      const thenGoto = step.params?.thenGoto;
      const elseGoto = step.params?.elseGoto;
      if (typeof thenGoto === "string" && thenGoto.trim() && steps.some((s) => s.id === thenGoto)) {
        dagreGraph.setEdge(step.id, thenGoto);
      }
      if (typeof elseGoto === "string" && elseGoto.trim() && steps.some((s) => s.id === elseGoto)) {
        dagreGraph.setEdge(step.id, elseGoto);
      }
    }
  });
  dagre.layout(dagreGraph);
  const nodes: Node[] = steps.map((step) => {
    const pos = dagreGraph.node(step.id);
    const handles = step.type === "if" ? READONLY_IF_HANDLES : READONLY_DEFAULT_PLUGIN_HANDLES;
    return {
      id: step.id,
      type: step.type === "if" ? "ifNode" : "defaultNode",
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: {
        label: `${step.id} (${step.type})`,
        stepType: step.type,
        params: step.params ?? {},
        dependencyModes: step.dependencyModes ?? {},
        retry: step.retry ?? 0,
        timeout: step.timeout ?? 0,
        disabled: step.disabled ?? false,
        handles,
      },
    };
  });

  const edges: Edge[] = [];
  const ifBranchTargets = new Set<string>();
  steps.forEach((s) => {
    if (s.type === "if") {
      const t = s.params?.thenGoto;
      const e = s.params?.elseGoto;
      if (typeof t === "string" && t.trim()) ifBranchTargets.add(t);
      if (typeof e === "string" && e.trim()) ifBranchTargets.add(e);
    }
  });
  steps.forEach((step) => {
    step.dependsOn?.forEach((dep, idx) => {
      const sourceStep = steps.find((s) => s.id === dep);
      const isIfBranch =
        sourceStep?.type === "if" && ifBranchTargets.has(step.id);
      if (isIfBranch) return;
      const isSwitchBranch =
        step.branch != null &&
        String(step.branch) !== "" &&
        idx === 0 &&
        sourceStep?.type === "switch";
      const isErrorEdge = step.errorFrom === dep;
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
        style: { stroke: isErrorEdge ? "#ef4444" : "#6b7280" },
      });
    });
  });
  steps.forEach((step) => {
    if (step.type === "if") {
      const thenGoto = step.params?.thenGoto;
      const elseGoto = step.params?.elseGoto;
      if (typeof thenGoto === "string" && thenGoto.trim() && steps.some((s) => s.id === thenGoto)) {
        edges.push({
          id: `${step.id}-true->${thenGoto}`,
          source: step.id,
          target: thenGoto,
          sourceHandle: "true",
          style: { stroke: "#6b7280" },
        });
      }
      if (typeof elseGoto === "string" && elseGoto.trim() && steps.some((s) => s.id === elseGoto)) {
        edges.push({
          id: `${step.id}-false->${elseGoto}`,
          source: step.id,
          target: elseGoto,
          sourceHandle: "false",
          style: { stroke: "#6b7280" },
        });
      }
    }
  });

  return { nodes, edges };
}

function nextStepId(existingIds: Set<string>, prefix: string): string {
  let i = 0;
  while (existingIds.has(`${prefix}_${i}`)) i++;
  const id = `${prefix}_${i}`;
  existingIds.add(id);
  return id;
}

const FALLBACK_STEP_TYPES = ["http", "log", "ai", "delay", "foreach", "if"];

const DEFAULT_HANDLES: PluginHandles = {
  inputs: [{ id: "default" }],
  outputs: [{ id: "default" }],
  errorOutput: true,
};

function getHandlesForStepType(pluginCatalog: PluginInfo[], stepType: string): PluginHandles {
  if (stepType === "if") {
    return {
      inputs: [{ id: "default" }],
      outputs: [{ id: "true" }, { id: "false" }],
      errorOutput: true,
    };
  }
  const plugin = pluginCatalog.find((p) => p.type === stepType);
  const handles = plugin?.handles ?? DEFAULT_HANDLES;
  return { ...handles, errorOutput: true };
}

function paramsContainLoopReference(params: Record<string, unknown> | undefined, loopStepId: string): boolean {
  const escapedLoopId = loopStepId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [/\{\{\s*loop\./, new RegExp(`\\{\\{\\s*loops\\.${escapedLoopId}\\.`)];
  const walk = (value: unknown): boolean => {
    if (typeof value === "string") return patterns.some((p) => p.test(value));
    if (Array.isArray(value)) return value.some((v) => walk(v));
    if (value && typeof value === "object") return Object.values(value).some((v) => walk(v));
    return false;
  };
  return walk(params);
}

function getAddStepOptions(pluginCatalog: PluginInfo[]): Record<"ai" | "data" | "control" | "utilities", NodeTypeDef[]> {
  const byCategory = getNodeTypesByCategory();
  const known = new Set(Object.keys(nodeRegistry));
  const pluginTypes = pluginCatalog.length > 0
    ? pluginCatalog.map((p) => p.type)
    : FALLBACK_STEP_TYPES;
  const result = {
    ai: [...byCategory.ai],
    data: [...byCategory.data],
    control: [...byCategory.control],
    utilities: [...byCategory.utilities],
  };
  for (const pluginType of pluginTypes) {
    if (!known.has(pluginType)) {
      const plugin = pluginCatalog.find((p) => p.type === pluginType);
      if (plugin?.trigger) continue;
      const category = (plugin?.category ?? "utilities") as keyof typeof result;
      const list = result[category] ?? result.utilities;
      list.push({
        type: pluginType,
        label: plugin?.label ?? pluginType,
        icon: "\u25A1",
        description: "",
        category: category,
        formComponent: ParamsFallbackForm,
      });
    }
  }
  return result;
}

export default function WorkflowEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingStep, setEditingStep] = useState<EditableStep | null>(null);
  const [pluginCatalog, setPluginCatalog] = useState<PluginInfo[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [testRunLoading, setTestRunLoading] = useState(false);
  const [testRunMessage, setTestRunMessage] = useState("");
  const [quickAddMenu, setQuickAddMenu] = useState<{
    position: { x: number; y: number };
    sourceNodeId?: string;
    sourceHandle?: string;
  } | null>(null);
  const lastSavedStepsRef = useRef<string | null>(null);

  const initial = useMemo(() => {
    if (!workflow?.steps?.length) return { nodes: [] as Node[], edges: [] as Edge[] };
    return stepsToNodesAndEdges(workflow.steps);
  }, [workflow?.steps]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);

  useEffect(() => {
    if (!workflow) return;
    const { nodes: n, edges: e } = stepsToNodesAndEdges(workflow.steps);
    setNodes(n);
    setEdges(e);
    lastSavedStepsRef.current = JSON.stringify(workflow.steps);
  }, [workflow?.steps]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWorkflowDetail(id)
      .then((w) => {
        if (!cancelled) setWorkflow(w);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    fetchPlugins()
      .then(setPluginCatalog)
      .catch(() => setPluginCatalog([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    fetchRuns()
      .then((runs) => {
        const run = runs.find((r) => r.workflowId === id);
        setLastRunId(run?.id ?? null);
      })
      .catch(() => setLastRunId(null));
  }, [id]);

  useEffect(() => {
    if (pluginCatalog.length === 0) return;
    setNodes((prev) =>
      prev.map((n) => {
        const d = n.data as { stepType?: string; params?: Record<string, unknown> };
        const stepType = d?.stepType ?? "";
        const plugin = pluginCatalog.find((p) => p.type === stepType);
        const handles = getHandlesForStepType(pluginCatalog, stepType);
        const summaryTemplate = plugin?.summaryTemplate ?? undefined;
        return {
          ...n,
          data: { ...n.data, handles, summaryTemplate },
        };
      })
    );
  }, [pluginCatalog, setNodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) {
        setError("A step cannot connect to itself.");
        return;
      }
      const duplicate = edges.some(
        (e) =>
          e.source === connection.source &&
          e.target === connection.target &&
          (e.sourceHandle || "") === (connection.sourceHandle || "")
      );
      if (duplicate) {
        setError("Duplicate connection is not allowed.");
        return;
      }
      setError("");
      setEdges((eds) => addEdge(connection, eds));
    },
    [setEdges, edges]
  );

  const existingIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const addStepOptions = useMemo(() => getAddStepOptions(pluginCatalog), [pluginCatalog]);
  const paletteSearchLower = paletteSearch.trim().toLowerCase();
  const filteredAddStepOptions = useMemo(() => {
    if (!paletteSearchLower) return addStepOptions;
    const out: Record<"ai" | "data" | "control" | "utilities", NodeTypeDef[]> = { ai: [], data: [], control: [], utilities: [] };
    (["ai", "data", "control", "utilities"] as const).forEach((cat) => {
      out[cat] = (addStepOptions[cat] ?? []).filter(
        (def) =>
          def.type.toLowerCase().includes(paletteSearchLower) ||
          (def.label ?? "").toLowerCase().includes(paletteSearchLower) ||
          (def.description ?? "").toLowerCase().includes(paletteSearchLower)
      );
    });
    return out;
  }, [addStepOptions, paletteSearchLower]);

  const addNode = useCallback(
    (
      stepType: string,
      position?: { x: number; y: number },
      connectFrom?: { sourceNodeId: string; sourceHandle?: string }
    ) => {
      const prefix = stepType === "if" ? "if" : stepType === "foreach" ? "loop" : "step";
      const newId = nextStepId(new Set(existingIds), prefix);
      const params = DEFAULT_PARAMS[stepType] ?? {};
      const plugin = pluginCatalog.find((p) => p.type === stepType);
      let pos: { x: number; y: number };
      if (position) {
        pos = position;
      } else {
        const selected = nodes.filter((n) => n.selected);
        if (selected.length > 0) {
          const rightmost = Math.max(...selected.map((n) => (n.position?.x ?? 0) + 120));
          const minY = Math.min(...selected.map((n) => n.position?.y ?? 0));
          const maxY = Math.max(...selected.map((n) => (n.position?.y ?? 0) + 72));
          pos = { x: rightmost + 80, y: (minY + maxY) / 2 - 36 };
        } else {
          pos = { x: 250 + nodes.length * 30, y: 100 + (nodes.length % 4) * 120 };
        }
      }
      const node: Node = {
        id: newId,
        type: stepType === "if" ? "ifNode" : "defaultNode",
        position: pos,
        data: {
          label: `${newId} (${stepType})`,
          stepType,
          params,
          dependencyModes: {},
          retry: 0,
          timeout: 0,
          disabled: false,
          handles: getHandlesForStepType(pluginCatalog, stepType),
          summaryTemplate: plugin?.summaryTemplate,
        },
      };
      setNodes((nds) => [...nds, node]);
      if (connectFrom) {
        setEdges((eds) => [
          ...eds,
          {
            id: `${connectFrom.sourceNodeId}-${newId}`,
            source: connectFrom.sourceNodeId,
            target: newId,
            ...(connectFrom.sourceHandle ? { sourceHandle: connectFrom.sourceHandle } : {}),
          },
        ]);
      }
    },
    [existingIds, nodes.length, pluginCatalog, setNodes, setEdges]
  );

  const buildEditingStepParams = useCallback(
    (node: Node, baseParams: Record<string, unknown>) => {
      const stepType = (node.data as { stepType?: string })?.stepType ?? "log";
      if (stepType !== "if") return baseParams;
      const thenGoto =
        edges.find((e) => e.source === node.id && (e as { sourceHandle?: string }).sourceHandle === "true")?.target ??
        (baseParams.thenGoto ?? "");
      const elseGoto =
        edges.find((e) => e.source === node.id && (e as { sourceHandle?: string }).sourceHandle === "false")?.target ??
        (baseParams.elseGoto ?? "");
      return { ...baseParams, thenGoto, elseGoto };
    },
    [edges]
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      const dependsOn = edges.filter((e) => e.target === node.id).map((e) => e.source);
      const d = node.data as {
        stepType?: string;
        params?: Record<string, unknown>;
        dependencyModes?: Record<string, "iteration" | "barrier">;
        retry?: number;
        timeout?: number;
      };
      const params = buildEditingStepParams(node, d.params ?? {});
      setEditingStep({
        id: node.id,
        type: d.stepType ?? "log",
        params,
        dependencyModes: d.dependencyModes ?? {},
        retry: d.retry ?? 0,
        timeout: d.timeout ?? 0,
        dependsOn,
      });
    },
    [edges, buildEditingStepParams]
  );

  const onEditNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const dependsOn = edges.filter((e) => e.target === nodeId).map((e) => e.source);
      const d = node.data as {
        stepType?: string;
        params?: Record<string, unknown>;
        dependencyModes?: Record<string, "iteration" | "barrier">;
        retry?: number;
        timeout?: number;
      };
      const params = buildEditingStepParams(node, d.params ?? {});
      setEditingStep({
        id: node.id,
        type: d.stepType ?? "log",
        params,
        dependencyModes: d.dependencyModes ?? {},
        retry: d.retry ?? 0,
        timeout: d.timeout ?? 0,
        dependsOn,
      });
    },
    [nodes, edges, buildEditingStepParams]
  );

  const deleteNodes = useCallback((ids: string[], skipConfirm?: boolean) => {
    if (ids.length === 0) return;
    const dependentsBySource = new Map<string, number>();
    edges.forEach((e) => {
      if (ids.includes(e.source)) {
        dependentsBySource.set(e.source, (dependentsBySource.get(e.source) ?? 0) + 1);
      }
    });
    const totalDependents = Array.from(dependentsBySource.values()).reduce((a, b) => a + b, 0);
    if (totalDependents > 0 && !skipConfirm) {
      const ok = window.confirm(
        `This step has ${totalDependents} step(s) that depend on it. Delete anyway?`
      );
      if (!ok) return;
    }
    const idSet = new Set(ids);
    setNodes((nds) => nds.filter((n) => !idSet.has(n.id)));
    setEdges((eds) => eds.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)));
  }, [edges, setNodes, setEdges]);

  const onDeleteNode = useCallback((nodeId: string) => deleteNodes([nodeId], false), [deleteNodes]);

  const onDuplicateNode = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const d = node.data as { stepType?: string; params?: Record<string, unknown>; retry?: number; timeout?: number };
    const stepType = d.stepType ?? "log";
    const prefix = stepType === "if" ? "if" : stepType === "foreach" ? "loop" : "step";
    const newId = nextStepId(new Set(nodes.map((n) => n.id)), prefix);
    const newNode: Node = {
      id: newId,
      type: node.type,
      position: { x: (node.position.x ?? 0) + 220, y: node.position.y ?? 0 },
      data: {
        label: `${newId} (${stepType})`,
        stepType,
        params: { ...(d.params ?? {}) },
        dependencyModes: {},
        retry: d.retry ?? 0,
        timeout: d.timeout ?? 0,
        disabled: false,
      },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [nodes, setNodes]);

  const onToggleDisabled = useCallback((nodeId: string) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== nodeId) return n;
        const d = n.data as { disabled?: boolean };
        return { ...n, data: { ...n.data, disabled: !d.disabled } };
      })
    );
  }, [setNodes]);

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
  }, []);

  const handleEdgeClick = useCallback((_e: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(edge.id);
  }, []);

  const edgesWithSelection = useMemo(
    () =>
      edges.map((e) => {
        const sourceHandle = (e as Edge & { sourceHandle?: string }).sourceHandle;
        const label =
          sourceHandle === "true" ? "true" : sourceHandle === "false" ? "false" : sourceHandle === "error" ? "error" : undefined;
        return {
          ...e,
          selected: e.id === selectedEdgeId,
          ...(label ? { label, labelStyle: { fill: "#e5e7eb", fontWeight: 600 }, labelBgStyle: { fill: "#1f2937" }, labelBgPadding: [4, 2] as [number, number], labelBgBorderRadius: 4 } : {}),
        };
      }),
    [edges, selectedEdgeId]
  );

  useEffect(() => {
    if (selectedEdgeId && !edges.some((e) => e.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [edges, selectedEdgeId]);

  const handlePaneClick = useCallback(() => setSelectedEdgeId(null), []);
  const removeSelectedEdge = useCallback(() => {
    if (selectedEdgeId) {
      setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
    }
  }, [selectedEdgeId, setEdges]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [contextMenu]);

  const handleSaveStep = useCallback(
    (updated: EditableStep) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== updated.id) return n;
          return {
            ...n,
            data: {
              ...n.data,
              label: `${updated.id} (${updated.type})`,
              stepType: updated.type,
              params: updated.params ?? {},
              dependencyModes: updated.dependencyModes ?? {},
              retry: updated.retry ?? 0,
              timeout: updated.timeout ?? 0,
            },
          };
        })
      );
      if (updated.type === "if") {
        setEdges((eds) => {
          const withoutIfBranches = eds.filter(
            (e) =>
              !(e.source === updated.id && ["true", "false"].includes((e as { sourceHandle?: string }).sourceHandle ?? ""))
          );
          const next: Edge[] = [...withoutIfBranches];
          const thenGoto = typeof updated.params?.thenGoto === "string" ? updated.params.thenGoto.trim() : "";
          const elseGoto = typeof updated.params?.elseGoto === "string" ? updated.params.elseGoto.trim() : "";
          if (thenGoto) {
            next.push({
              id: `${updated.id}-true->${thenGoto}`,
              source: updated.id,
              target: thenGoto,
              sourceHandle: "true",
              style: { stroke: "#6b7280" },
            });
          }
          if (elseGoto) {
            next.push({
              id: `${updated.id}-false->${elseGoto}`,
              source: updated.id,
              target: elseGoto,
              sourceHandle: "false",
              style: { stroke: "#6b7280" },
            });
          }
          return next;
        });
      }
      setEditingStep(null);
    },
    [setNodes, setEdges]
  );

  const buildSteps = useCallback((): WorkflowDetail["steps"] => {
    return nodes.map((node) => {
      const d = node.data as {
        stepType?: string;
        params?: Record<string, unknown>;
        dependencyModes?: Record<string, "iteration" | "barrier">;
        retry?: number;
        timeout?: number;
        disabled?: boolean;
      };
      const incomingEdges = edges.filter((e) => e.target === node.id);
      const dependsOn = [...new Set(incomingEdges.map((e) => e.source))];
      const sourceNodeFromSwitch = incomingEdges.find((e) => {
        const src = nodes.find((n) => n.id === e.source);
        const stepType = (src?.data as { stepType?: string })?.stepType;
        return stepType === "switch" && (e as { sourceHandle?: string }).sourceHandle;
      }) as (typeof incomingEdges)[0] & { sourceHandle?: string } | undefined;
      const errorEdge = incomingEdges.find((e) => isErrorOutputEdge(e)) as (typeof incomingEdges)[0] & { sourceHandle?: string } | undefined;
      const branch = sourceNodeFromSwitch?.sourceHandle ?? undefined;
      const errorFrom = errorEdge?.source ?? undefined;
      const stepType = d.stepType ?? "log";
      let params = d.params ?? {};
      const explicitModes = d.dependencyModes ?? {};
      const dependencyModes = Object.fromEntries(
        dependsOn
          .map((depId) => {
            const depNode = nodes.find((n) => n.id === depId);
            const depType = (depNode?.data as { stepType?: string } | undefined)?.stepType;
            if (depType !== "foreach") return null;
            const mode = explicitModes[depId] ?? (paramsContainLoopReference(params, depId) ? "iteration" : "barrier");
            return [depId, mode] as const;
          })
          .filter((row): row is readonly [string, "iteration" | "barrier"] => row !== null)
      );
      if (stepType === "if") {
        const thenGoto = edges.find((e) => e.source === node.id && (e as { sourceHandle?: string }).sourceHandle === "true")?.target ?? "";
        const elseGoto = edges.find((e) => e.source === node.id && (e as { sourceHandle?: string }).sourceHandle === "false")?.target ?? "";
        params = { ...params, thenGoto, elseGoto };
      }
      return {
        id: node.id,
        type: stepType,
        params,
        retry: d.retry ?? 0,
        timeout: d.timeout ?? 0,
        disabled: d.disabled ?? false,
        dependsOn,
        dependencyModes,
        ...(branch ? { branch } : {}),
        ...(errorFrom ? { errorFrom } : {}),
      };
    });
  }, [nodes, edges]);

  const isDirty = useMemo(() => {
    if (!workflow) return false;
    const current = JSON.stringify(buildSteps());
    return lastSavedStepsRef.current !== null && current !== lastSavedStepsRef.current;
  }, [workflow, buildSteps, nodes, edges]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const handleCancel = useCallback(() => {
    if (isDirty && !window.confirm("You have unsaved changes. Leave?")) return;
    if (id) navigate(`/workflows/${id}`);
  }, [isDirty, id, navigate]);

  const [lastStepErrors, setLastStepErrors] = useState<Record<string, Record<string, string>> | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const validationResult = useMemo(() => {
    const steps = buildSteps();
    const base = validateWorkflow(steps);
    const edgeList = edges.map((e) => ({
      source: e.source,
      target: e.target,
      sourceHandle: (e as Edge & { sourceHandle?: string }).sourceHandle,
    }));
    const branchWarnings = collectBranchWarnings(steps, edgeList);
    return {
      ...base,
      warnings: [...base.warnings, ...branchWarnings],
    };
  }, [buildSteps, edges]);
  const stepWarnings = validationResult.stepWarnings;
  const nodesWithWarnings = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          hasWarning: Object.keys(stepWarnings[n.id] ?? {}).length > 0,
        },
      })),
    [nodes, stepWarnings]
  );

  const handleSaveWorkflow = useCallback(async () => {
    if (!id || !workflow) return;
    const steps = buildSteps();
    const validation = validateWorkflow(steps);
    if (!validation.valid) {
      setError(validation.errors.join(". "));
      setLastStepErrors(validation.stepErrors);
      return;
    }
    setSaving(true);
    setError(null);
    setLastStepErrors(null);
    try {
      await updateWorkflow(id, {
        name: (workflow.name ?? "").trim() || "Untitled",
        steps,
        maxParallel: workflow.maxParallel,
        trigger: workflow.trigger ?? { type: "manual" },
      });
      const updated = await fetchWorkflowDetail(id);
      setWorkflow(updated);
      lastSavedStepsRef.current = JSON.stringify(updated.steps);
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [id, workflow, buildSteps]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingStep) return;
      if (e.key === "Escape") {
        setEditingStep(null);
        setQuickAddMenu(null);
        setContextMenu(null);
        setSelectedEdgeId(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSaveWorkflow();
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id);
      if (selectedIds.length > 0) {
        e.preventDefault();
        deleteNodes(selectedIds);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nodes, deleteNodes, handleSaveWorkflow, editingStep]);

  const runAutoLayout = useCallback(() => {
    const steps = buildSteps();
    const { nodes: n, edges: e } = stepsToNodesAndEdges(steps);
    setNodes(n);
    setEdges(e);
  }, [buildSteps, setNodes, setEdges]);

  const handleTestRun = useCallback(async () => {
    if (!id) return;
    setTestRunLoading(true);
    setTestRunMessage("");
    try {
      const result = await startRun(id);
      setLastRunId(result.runId);
      setTestRunMessage(`Test run queued: ${result.runId}`);
    } catch (err) {
      setTestRunMessage(err instanceof Error ? err.message : "Test run failed");
    } finally {
      setTestRunLoading(false);
    }
  }, [id]);

  if (loading) return <div className="pageLayout"><div className="spinner" /></div>;
  if (error && !workflow) return <div className="pageLayout">Error: {error}</div>;
  if (!workflow) return <div className="pageLayout">Workflow not found</div>;

  return (
    <div className="pageLayout pageLayout--edit">
      {quickAddMenu && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            top: "40%",
            transform: "translate(-50%, -50%)",
            zIndex: 1001,
            background: "#1f2937",
            border: "1px solid #374151",
            borderRadius: 12,
            padding: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            maxWidth: 320,
            maxHeight: "70vh",
            overflow: "auto",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
            {quickAddMenu.sourceNodeId ? "Create new step (connect from handle)" : "Add step here"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(["data", "ai", "control", "utilities"] as const).map((cat) =>
              (filteredAddStepOptions[cat] ?? []).map((def: NodeTypeDef) => (
                <button
                  key={def.type}
                  type="button"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    textAlign: "left",
                    background: "#0b1220",
                    border: "1px solid #374151",
                    borderRadius: 6,
                    color: "#e5e7eb",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                  onClick={() => {
                    addNode(
                      def.type,
                      quickAddMenu.position,
                      quickAddMenu.sourceNodeId
                        ? { sourceNodeId: quickAddMenu.sourceNodeId, sourceHandle: quickAddMenu.sourceHandle }
                        : undefined
                    );
                    setQuickAddMenu(null);
                  }}
                >
                  <span>{def.icon}</span>
                  <span>{def.label}</span>
                </button>
              ))
            )}
          </div>
          <button
            type="button"
            style={{ marginTop: 10, padding: "6px 12px", fontSize: 12, background: "#374151", border: "none", borderRadius: 6, color: "#e5e7eb", cursor: "pointer" }}
            onClick={() => setQuickAddMenu(null)}
          >
            Cancel
          </button>
        </div>
      )}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
            background: "#1f2937",
            border: "1px solid #374151",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            padding: "4px 0",
            minWidth: 160,
          }}
        >
          <button
            type="button"
            style={{ display: "block", width: "100%", padding: "8px 12px", textAlign: "left", background: "none", border: "none", color: "#e5e7eb", cursor: "pointer", fontSize: 13 }}
            onClick={() => { onEditNode(contextMenu.nodeId); setContextMenu(null); }}
          >
            Edit
          </button>
          <button
            type="button"
            style={{ display: "block", width: "100%", padding: "8px 12px", textAlign: "left", background: "none", border: "none", color: "#e5e7eb", cursor: "pointer", fontSize: 13 }}
            onClick={() => { onDuplicateNode(contextMenu.nodeId); setContextMenu(null); }}
          >
            Duplicate
          </button>
          <button
            type="button"
            style={{ display: "block", width: "100%", padding: "8px 12px", textAlign: "left", background: "none", border: "none", color: "#e5e7eb", cursor: "pointer", fontSize: 13 }}
            onClick={() => { onToggleDisabled(contextMenu.nodeId); setContextMenu(null); }}
          >
            Disable / Enable
          </button>
          <button
            type="button"
            style={{ display: "block", width: "100%", padding: "8px 12px", textAlign: "left", background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 13 }}
            onClick={() => {
              deleteNodes([contextMenu.nodeId]);
              setContextMenu(null);
            }}
          >
            Delete node
          </button>
        </div>
      )}
      {editingStep && (
        <StepEditModal
          step={editingStep}
          steps={buildSteps()}
          workflowId={id}
          pluginCatalog={pluginCatalog}
          stepErrorsFromWorkflow={lastStepErrors?.[editingStep.id]}
          stepWarningsFromWorkflow={stepWarnings[editingStep.id] ?? {}}
          onClose={() => setEditingStep(null)}
          onSave={handleSaveStep}
        />
      )}
      <header className="pageHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <label style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>Workflow name</label>
          <input
            type="text"
            value={workflow.name}
            onChange={(e) => setWorkflow({ ...workflow, name: e.target.value })}
            placeholder="Workflow name"
            style={{
              width: "100%",
              maxWidth: 320,
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#0f172a",
              fontSize: 16,
              fontWeight: 600,
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={runAutoLayout}>Auto-layout</button>
          <button onClick={handleTestRun} disabled={testRunLoading || !id}>
            {testRunLoading ? "Testing…" : "Test run"}
          </button>
          <button onClick={handleSaveWorkflow} disabled={saving}>
            {saving ? "Saving…" : "Save workflow"}
          </button>
          {testRunMessage && <span style={{ fontSize: 12, color: "#60a5fa" }}>{testRunMessage}</span>}
          {savedAt && (
            <span style={{ fontSize: 12, color: "#22c55e" }} title={savedAt.toLocaleString()}>
              Saved {savedAt.toLocaleTimeString()}
            </span>
          )}
          <button onClick={() => id && navigate(`/workflows/${id}`)}>View workflow</button>
          {lastRunId && (
            <Link
              to={`/runs/${lastRunId}`}
              style={{ fontSize: 13, color: "#60a5fa", textDecoration: "none" }}
              target="_blank"
              rel="noopener noreferrer"
            >
              Last run
            </Link>
          )}
          <button onClick={handleCancel}>Cancel</button>
        </div>
      </header>
      <main className="pageContent">
      <div className="card" style={{ marginBottom: 10, display: "flex", flexDirection: "row", gap: 16, padding: 12 }}>
        <h3 style={{ display: "flex", flexDirection: "row", gap: 16, alignItems: "center", fontSize: 16, fontWeight: 600 }}>Trigger : 
          </h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end", flexDirection: "row" }}>
          <div style={{ display: "flex", flexDirection: "row", gap: 16, alignItems: "center" }}>
            
            <select
              value={typeof workflow.trigger === "object" && workflow.trigger !== null ? workflow.trigger.type : "manual"}
              onChange={(e) => {
                const type = e.target.value as "manual" | "cron" | "trigger.webhook";
                const prev: WorkflowTrigger = typeof workflow.trigger === "object" && workflow.trigger !== null ? workflow.trigger : { type: "manual" };
                setWorkflow({ ...workflow, trigger: { ...prev, type } });
              }}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#0f172a",
                fontSize: 13,
                minWidth: 120,
              }}
            >
              <option value="manual">Manual</option>
              <option value="cron">Cron</option>
              <option value="trigger.webhook">Webhook</option>
            </select>
          </div>
          {typeof workflow.trigger === "object" && workflow.trigger !== null && workflow.trigger.type === "cron" && (
            <>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>Cron expression</label>
                <input
                  type="text"
                  placeholder="0 9 * * *"
                  value={(workflow.trigger.cron ?? workflow.trigger.schedule) ?? ""}
                  onChange={(e) => {
                    const prev: WorkflowTrigger = workflow.trigger as WorkflowTrigger;
                    setWorkflow({ ...workflow, trigger: { ...prev, cron: e.target.value.trim() || undefined } });
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    color: "#0f172a",
                    fontSize: 13,
                    width: 140,
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>Timezone (optional)</label>
                <input
                  type="text"
                  placeholder="Europe/Istanbul"
                  value={typeof workflow.trigger === "object" && workflow.trigger !== null ? (workflow.trigger.timezone ?? "") : ""}
                  onChange={(e) => {
                    const prev: WorkflowTrigger = workflow.trigger as WorkflowTrigger;
                    setWorkflow({ ...workflow, trigger: { ...prev, timezone: e.target.value.trim() || undefined } });
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    color: "#0f172a",
                    fontSize: 13,
                    width: 160,
                  }}
                />
              </div>
            </>
          )}
          {typeof workflow.trigger === "object" && workflow.trigger !== null && workflow.trigger.type === "trigger.webhook" && (
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>Webhook secret (optional)</label>
              <input
                type="text"
                placeholder="Token for X-Webhook-Secret or ?secret="
                value={(workflow.trigger as WorkflowTrigger).webhookSecret ?? ""}
                onChange={(e) => {
                  const prev: WorkflowTrigger = workflow.trigger as WorkflowTrigger;
                  setWorkflow({ ...workflow, trigger: { ...prev, webhookSecret: e.target.value.trim() || undefined } });
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#0f172a",
                  fontSize: 13,
                  width: 220,
                }}
              />
            </div>
          )}
        </div>
      </div>
      {error && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ color: "#ef4444", fontWeight: 600, marginBottom: 4 }}>Validation errors</div>
          <ul style={{ color: "#f87171", margin: 0, paddingLeft: 20 }}>
            {error.split(". ").filter(Boolean).map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      )}
      {validationResult.warnings.length > 0 && (
        <div style={{ marginBottom: 8, padding: 8, background: "rgba(234,179,8,0.1)", border: "1px solid #eab308", borderRadius: 8 }}>
          <div style={{ color: "#eab308", fontWeight: 600, marginBottom: 4 }}>Variable warnings (save is allowed)</div>
          <ul style={{ color: "#ca8a04", margin: 0, paddingLeft: 20, fontSize: 13 }}>
            {validationResult.warnings.slice(0, 5).map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
            {validationResult.warnings.length > 5 && (
              <li key="more">… and {validationResult.warnings.length - 5} more</li>
            )}
          </ul>
        </div>
      )}
      <div className="workflowEditWorkspace">
        <div className="card workflowEditSidebar">
          <h3 className="workflowEditSidebar__title">Add step</h3>
          <div className="workflowEditSidebar__search">
            <input
              type="text"
              placeholder="Search plugins…"
              value={paletteSearch}
              onChange={(e) => setPaletteSearch(e.target.value)}
              className="workflowEditSidebar__input"
            />
          </div>
          <div className="workflowEditSidebar__list">
          {(["ai", "data", "control", "utilities"] as const).map((cat) => {
            const list = filteredAddStepOptions[cat];
            if (!list?.length) return null;
            return (
              <div key={cat} className={`workflowEditSidebar__group workflowEditSidebar__group--${cat}`}>
                <div className="workflowEditSidebar__category">
                  {NODE_CATEGORIES[cat]}
                </div>
                {list.map((def: NodeTypeDef) => (
                  <button
                    key={def.type}
                    type="button"
                    className="workflowEditSidebar__item"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/x-workflow-step-type", def.type);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => addNode(def.type)}
                    title={def.description || def.label}
                    data-category={cat}
                  >
                    <span className="workflowEditSidebar__icon">{def.icon}</span>
                    <span className="workflowEditSidebar__label">{def.label}</span>
                  </button>
                ))}
              </div>
            );
          })}
          </div>
          {paletteSearchLower && Object.values(filteredAddStepOptions).every((arr) => arr.length === 0) && (
            <p className="workflowEditSidebar__empty">No plugins match your search.</p>
          )}
        </div>
        <div className="card workflowEditCanvas">
          <div className="workflowEditCanvasInner">
            {nodes.length === 0 && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 5,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 24,
                  background: "rgba(11, 18, 32, 0.85)",
                  borderRadius: 12,
                }}
              >
                <p style={{ color: "#9ca3af", fontSize: 14, marginBottom: 8, textAlign: "center", maxWidth: 320 }}>
                  Add steps from the left panel and connect them with the dots to define execution order. Steps with no incoming connections run first.
                </p>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
                  <button
                    type="button"
                    onClick={() => addNode("log")}
                    style={{
                      padding: "10px 20px",
                      background: "#3b82f6",
                      border: "none",
                      borderRadius: 8,
                      color: "#fff",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontSize: 14,
                    }}
                  >
                    Add your first step
                  </button>
                  <Link
                    to="/templates"
                    style={{
                      padding: "10px 20px",
                      background: "#1f2937",
                      border: "1px solid #374151",
                      borderRadius: 8,
                      color: "#e5e7eb",
                      textDecoration: "none",
                      fontSize: 14,
                    }}
                  >
                    Start from a template
                  </Link>
                </div>
              </div>
            )}
            {selectedEdgeId && (
              <div
                style={{
                  position: "absolute",
                  top: 8,
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: 8,
                  padding: "6px 12px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                }}
              >
                <span style={{ fontSize: 12, color: "#9ca3af" }}>Edge selected</span>
                <button
                  type="button"
                  onClick={removeSelectedEdge}
                  style={{ padding: "4px 10px", fontSize: 12, background: "#dc2626", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer" }}
                >
                  Remove edge
                </button>
              </div>
            )}
            <WorkflowEditorContext.Provider
              value={{
                onEditNode,
                onDeleteNode,
                onDuplicateNode,
                onToggleDisabled,
              }}
            >
              <ReactFlowProvider>
                <EditorFlowInner
                  nodes={nodesWithWarnings}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onNodeClick={handleNodeClick}
                  onNodeContextMenu={handleNodeContextMenu}
                  onEdgeClick={handleEdgeClick}
                  onPaneClick={handlePaneClick}
                  nodeTypes={nodeTypes}
                  lastStepErrors={lastStepErrors}
                  addNode={addNode}
                  edgesWithSelection={edgesWithSelection}
                  onConnectEndRequest={(position, sourceNodeId, sourceHandle) =>
                    setQuickAddMenu({ position, sourceNodeId, sourceHandle })
                  }
                  onPaneContextMenuRequest={() => {}}
                />
              </ReactFlowProvider>
            </WorkflowEditorContext.Provider>
          </div>
        </div>
      </div>
      </main>
    </div>
  );
}

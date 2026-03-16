import { useState, useEffect } from "react";
import { buildOutputTree } from "../utils/variableSystem";
import type { VariableTreeNode } from "../utils/variableSystem";
import { useRunData } from "../contexts/RunDataContext";

type OutputStructurePreviewProps = {
  workflowId: string;
  /** Step being edited (to exclude from upstream list). */
  stepId: string;
  /** Upstream steps that can be previewed (e.g. steps that run before the current one). */
  steps?: { id: string }[];
  onInsertPath: (path: string) => void;
};

function JsonKey({
  path,
  node,
  onInsert,
}: {
  path: string;
  node: VariableTreeNode;
  onInsert: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children && node.children.length > 0;

  if (node.path) {
    return (
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => {
          e.preventDefault();
          onInsert(node.path!);
        }}
        style={{
          display: "block",
          textAlign: "left",
          padding: "2px 6px",
          border: "none",
          background: "none",
          color: "#93c5fd",
          cursor: "pointer",
          fontSize: 12,
          fontFamily: "monospace",
          borderRadius: 4,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(59, 130, 246, 0.15)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
        }}
      >
        {node.name}
        {node.path && <span style={{ color: "#6b7280", marginLeft: 4 }}>→ {node.path}</span>}
      </button>
    );
  }

  return (
    <div style={{ marginLeft: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {hasChildren && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={{
              border: "none",
              background: "none",
              color: "#9ca3af",
              cursor: "pointer",
              padding: 0,
              fontSize: 10,
            }}
          >
            {open ? "▼" : "▶"}
          </button>
        )}
        <span style={{ fontSize: 12, color: "#e5e7eb", fontFamily: "monospace" }}>{node.name}</span>
      </div>
      {hasChildren && open && (
        <div>
          {node.children!.map((child) => (
            <JsonKey
              key={child.name + (child.path ?? "")}
              path={path}
              node={child}
              onInsert={onInsert}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function OutputStructurePreview({
  workflowId,
  stepId: currentStepId,
  steps = [],
  onInsertPath,
}: OutputStructurePreviewProps) {
  const upstreamSteps = steps.filter((s) => s.id !== currentStepId);
  const [selectedStepId, setSelectedStepId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<VariableTreeNode[] | null>(null);
  const runData = useRunData();

  useEffect(() => {
    setTree(null);
    setError(null);
    const upstream = steps.filter((s) => s.id !== currentStepId);
    setSelectedStepId((prev) => (upstream.some((s) => s.id === prev) ? prev : upstream[0]?.id ?? ""));
  }, [workflowId, currentStepId, steps]);

  const handlePreview = async () => {
    const stepIdToFetch = selectedStepId || upstreamSteps[0]?.id;
    if (!stepIdToFetch) return;
    setLoading(true);
    setError(null);
    setTree(null);
    try {
      if (!runData) {
        throw new Error("Run data context not available");
      }
      const snapshot = await runData.getStepOutputSnapshot(workflowId, stepIdToFetch);
      if (!snapshot) {
        throw new Error("No output yet. Run the workflow first.");
      }
      setTree(buildOutputTree(stepIdToFetch, snapshot.output));
    } catch (e: unknown) {
      const message = e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : "Failed to load output.";
      setError(message || "No output yet. Run the workflow first.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>
        Select an upstream step to load its output shape from the latest run.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        {upstreamSteps.length > 0 && (
          <select
            value={selectedStepId}
            onChange={(e) => setSelectedStepId(e.target.value)}
            style={{
              padding: "4px 8px",
              fontSize: 12,
              border: "1px solid #374151",
              borderRadius: 6,
              background: "#1f2937",
              color: "#e5e7eb",
            }}
          >
            <option value="">Select step</option>
            {upstreamSteps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={handlePreview}
          disabled={loading || upstreamSteps.length === 0}
          style={{
            padding: "4px 10px",
            fontSize: 12,
            border: "1px solid #374151",
            borderRadius: 6,
            background: "#1f2937",
            color: "#93c5fd",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Loading…" : "Preview output structure"}
        </button>
      </div>
      {error && (
        <p style={{ fontSize: 12, color: "#f87171", marginTop: 6 }}>{error}</p>
      )}
      {tree && tree.length > 0 && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: "#0b1220",
            border: "1px solid #374151",
            borderRadius: 8,
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>Click a path to insert:</div>
          {tree.map((root) => (
            <JsonKey key={root.name} path="" node={root} onInsert={onInsertPath} />
          ))}
        </div>
      )}
    </div>
  );
}

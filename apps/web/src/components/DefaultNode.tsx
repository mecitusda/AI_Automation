import { Handle, Position, type NodeProps } from "reactflow";
import { getNodeColors } from "../utils/nodeColors";
import { useWorkflowEditor } from "../contexts/WorkflowEditorContext";
import { getNodeType, getNodeSummary } from "../nodes";
import type { PluginHandles } from "../api/plugins";
import { resolveSummaryTemplate } from "../api/plugins";

const toolbarBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#9ca3af",
  cursor: "pointer",
  padding: "2px 4px",
  fontSize: 12,
  lineHeight: 1,
  borderRadius: 4,
};

export default function DefaultNode({ id, data }: NodeProps) {
  const colors = getNodeColors(data.status);
  const editor = useWorkflowEditor();
  const disabled = Boolean(data.disabled);
  const stepType = (data as { stepType?: string }).stepType ?? "";
  const nodeType = getNodeType(stepType);
  const typeLabel = nodeType?.label ?? (stepType || "Step");
  const displayLabel = (data as { label?: string }).label ?? typeLabel;
  const icon = nodeType?.icon ?? "\u25A1";
  const description = (data as { description?: string }).description;
  const params = (data as { params?: Record<string, unknown> }).params ?? {};
  const summaryTemplate = (data as { summaryTemplate?: string }).summaryTemplate;
  const summary =
    description ??
    ((summaryTemplate ? resolveSummaryTemplate(summaryTemplate, params) : "") || getNodeSummary(stepType, params));
  const handles = (data as { handles?: PluginHandles }).handles ?? {
    inputs: [{ id: "default" }],
    outputs: [{ id: "default" }],
  };
  const inputs = handles.inputs?.length ? handles.inputs : [{ id: "default" }];
  const outputs = handles.outputs?.length ? handles.outputs : [{ id: "default" }];
  const errorOutput = handles.errorOutput === true;

  const inputHandles = inputs.map((h, i) => {
    const top = inputs.length === 1 ? "50%" : `${((i + 1) / (inputs.length + 1)) * 100}%`;
    return (
      <Handle
        key={h.id}
        type="target"
        position={Position.Left}
        id={h.id}
        style={{
          background: colors.dot,
          border: `2px solid ${colors.border}`,
          top,
          left: 0,
          transform: "translateY(-50%)",
        }}
      />
    );
  });

  const outputHandles = outputs.map((h, i) => {
    const top = outputs.length === 1 ? "50%" : `${((i + 1) / (outputs.length + 1)) * 100}%`;
    return (
      <Handle
        key={h.id}
        type="source"
        position={Position.Right}
        id={h.id}
        style={{
          background: colors.dot,
          border: `2px solid ${colors.border}`,
          top,
          left: "100%",
          transform: "translate(-50%, -50%)",
        }}
      />
    );
  });

  return (
    <div
      style={{
        width: 200,
        minHeight: 72,
        borderRadius: 12,
        border: `1.5px solid ${colors.border}`,
        background: colors.background,
        color: "#e5e7eb",
        display: "flex",
        flexDirection: "column",
        fontWeight: 500,
        fontSize: 13,
        boxShadow: colors.glow !== "none"
          ? `${colors.glow}, 0 4px 12px rgba(0,0,0,0.4)`
          : "0 4px 12px rgba(0,0,0,0.4)",
        position: "relative",
        transition: "all 0.3s ease",
        opacity: disabled ? 0.65 : 1,
      }}
    >
      {inputHandles}
      {editor && (
        <div
          className="node-toolbar"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 4,
            padding: "2px 4px 2px 6px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            minHeight: 24,
          }}
        >
          {data.status && (
            <span style={{ fontSize: 10 }}>
              {statusBadgeChip(String(data.status))}
            </span>
          )}
          <button
            type="button"
            title="Edit"
            onClick={(e) => { e.stopPropagation(); editor.onEditNode(id); }}
            style={toolbarBtnStyle}
          >
            &#9998;
          </button>
          <button
            type="button"
            title="Duplicate"
            onClick={(e) => { e.stopPropagation(); editor.onDuplicateNode(id); }}
            style={toolbarBtnStyle}
          >
            &#9096;
          </button>
          <button
            type="button"
            title={disabled ? "Enable" : "Disable"}
            onClick={(e) => { e.stopPropagation(); editor.onToggleDisabled(id); }}
            style={toolbarBtnStyle}
          >
            {disabled ? "\u25B6" : "\u23F8"}
          </button>
          <button
            type="button"
            title="Delete"
            onClick={(e) => { e.stopPropagation(); editor.onDeleteNode(id); }}
            style={{ ...toolbarBtnStyle, color: "#f87171" }}
          >
            &#10005;
          </button>
        </div>
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4px 8px", position: "relative" }}>
        {disabled && (
          <span style={{ position: "absolute", top: 2, left: 6, fontSize: 9, opacity: 0.9, textTransform: "uppercase" }}>
            Disabled
          </span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13 }}>
          {(data as { hasError?: boolean }).hasError && (
            <span title="This step has validation errors" style={{ color: "#ef4444", fontSize: 12 }}>⚠</span>
          )}
          {(data as { hasWarning?: boolean }).hasWarning && !(data as { hasError?: boolean }).hasError && (
            <span title="Variable warnings" style={{ color: "#eab308", fontSize: 12 }}>⚠</span>
          )}
          <span style={{ fontSize: 14 }}>{icon}</span>
          <span>{displayLabel}</span>
        </div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={summary}>
          {summary}
        </div>
        {(data.iterations?.length ?? 0) > 0 && (
          <span style={{ position: "absolute", top: 4, right: 8, fontSize: 10, opacity: 0.9 }} title={data.iterations.join(", ")}>
            {(data.iteration ?? 0) + 1}/{data.iterations.length}
          </span>
        )}
      </div>
      {outputHandles}
      {errorOutput && (
        <Handle
          type="source"
          position={Position.Right}
          id="error"
          style={{
            background: "#ef4444",
            border: "2px solid #b91c1c",
            bottom: 8,
            top: "auto",
            left: "100%",
            transform: "translate(-50%, 0)",
          }}
        />
      )}
    </div>
  );
}

function statusBadgeChip(status: string) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    running: { label: "RUN", bg: "#1f2937", color: "#facc15" },
    completed: { label: "OK", bg: "#022c22", color: "#22c55e" },
    failed: { label: "FAIL", bg: "#3f1d1d", color: "#ef4444" },
    skipped: { label: "SKIP", bg: "#111827", color: "#9ca3af" },
    pending: { label: "PEND", bg: "#111827", color: "#6b7280" },
    cancelled: { label: "CANC", bg: "#111827", color: "#9ca3af" },
    retrying: { label: "RETRY", bg: "#1f2937", color: "#f97316" },
  };
  const meta = map[status] ?? map.pending;
  return (
    <span
      style={{
        padding: "1px 4px",
        borderRadius: 4,
        background: meta.bg,
        color: meta.color,
      }}
      title={status}
    >
      {meta.label}
    </span>
  );
}


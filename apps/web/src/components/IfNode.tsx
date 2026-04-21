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
  fontSize: 11,
  lineHeight: 1,
  borderRadius: 4,
};

export default function IfNode({ id, data }: NodeProps) {
  const colors = getNodeColors(data.status);
  const editor = useWorkflowEditor();
  const disabled = Boolean(data.disabled);
  const nodeType = getNodeType((data as { stepType?: string }).stepType ?? "if");
  const typeLabel = nodeType?.label ?? "IF";
  const icon = nodeType?.icon ?? "\u25C7";
  const params = (data as { params?: Record<string, unknown> }).params ?? {};
  const summaryTemplate = (data as { summaryTemplate?: string }).summaryTemplate;
  const summary =
    (summaryTemplate ? resolveSummaryTemplate(summaryTemplate, params) : "") ||
    getNodeSummary((data as { stepType?: string }).stepType ?? "if", params);
  const handles = (data as { handles?: PluginHandles }).handles ?? {
    inputs: [{ id: "default" }],
    outputs: [{ id: "true" }, { id: "false" }],
  };
  const outputs = handles.outputs?.length ? handles.outputs : [{ id: "true" }, { id: "false" }];
  const errorOutput = handles.errorOutput === true;

  return (
    <div
      style={{
        width: 160,
        height: 160,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        filter: colors.glow !== "none" ? `drop-shadow(0 0 8px ${colors.border})` : "none",
        transition: "all 0.3s ease",
        opacity: disabled ? 0.65 : 1,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="default"
        style={{ background: colors.dot, border: `2px solid ${colors.border}`, top: "50%" }}
      />
      {editor && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 2,
            padding: "0 4px",
            zIndex: 2,
          }}
        >
          <button type="button" title="Edit" onClick={(e) => { e.stopPropagation(); editor.onEditNode(id); }} style={toolbarBtnStyle}>&#9998;</button>
          <button type="button" title="Duplicate" onClick={(e) => { e.stopPropagation(); editor.onDuplicateNode(id); }} style={toolbarBtnStyle}>&#9096;</button>
          <button type="button" title={disabled ? "Enable" : "Disable"} onClick={(e) => { e.stopPropagation(); editor.onToggleDisabled(id); }} style={toolbarBtnStyle}>{disabled ? "\u25B6" : "\u23F8"}</button>
          <button type="button" title="Delete" onClick={(e) => { e.stopPropagation(); editor.onDeleteNode(id); }} style={{ ...toolbarBtnStyle, color: "#f87171" }}>&#10005;</button>
        </div>
      )}
      <svg width="140" height="140">
        <polygon points="70,0 140,70 70,140 0,70" fill={colors.background} stroke={colors.border} strokeWidth="2" />
      </svg>
      <div
        style={{
          position: "absolute",
          color: "#f9fafb",
          fontWeight: 600,
          fontSize: 13,
          textAlign: "center",
          width: "100px",
          pointerEvents: "none",
        }}
      >
        {disabled && <span style={{ display: "block", fontSize: 9, opacity: 0.9, textTransform: "uppercase" }}>Disabled</span>}
        {(data as { hasError?: boolean }).hasError && <span title="This step has validation errors" style={{ color: "#ef4444", fontSize: 11, display: "block" }}>⚠</span>}
        {(data as { hasWarning?: boolean }).hasWarning && !(data as { hasError?: boolean }).hasError && (
          <span title="Variable warnings" style={{ color: "#eab308", fontSize: 11, display: "block" }}>⚠</span>
        )}
        <span style={{ fontSize: 12 }}>{icon} {typeLabel}</span>
        <div style={{ fontSize: 10, opacity: 0.9, marginTop: 2 }}>{summary}</div>
        {(data.iterations?.length ?? 0) > 0 && (
          <span style={{ fontSize: 10, opacity: 0.9 }} title={data.iterations.join(", ")}>
            {(data.iteration ?? 0) + 1}/{data.iterations.length}
          </span>
        )}
        {String(data.status) === "failed" && (data as { failureHint?: string }).failureHint ? (
          <div
            style={{
              fontSize: 9,
              color: "#fca5a5",
              marginTop: 4,
              maxWidth: 90,
              whiteSpace: "normal",
              wordBreak: "break-word",
              lineHeight: 1.2,
            }}
            title={String((data as { failureHint?: string }).failureHint)}
          >
            {(() => {
              const h = String((data as { failureHint?: string }).failureHint ?? "");
              return h.length > 100 ? `${h.slice(0, 100)}…` : h;
            })()}
          </div>
        ) : null}
      </div>
      {outputs.map((h, i) => {
        const top = outputs.length === 1 ? "50%" : i === 0 ? "35%" : "65%";
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
      })}
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

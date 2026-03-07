import { Handle, Position, type NodeProps } from "reactflow";
import { getNodeColors } from "../utils/nodeColors";

export default function DefaultNode({ data }: NodeProps) {
  const colors = getNodeColors(data.status);

  return (
    <div
      style={{
        width: 180,
        height: 60,
        borderRadius: 12,
        border: `1.5px solid ${colors.border}`,
        background: colors.background,
        color: "#e5e7eb",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 500,
        fontSize: 13,
        boxShadow: colors.glow !== "none"
          ? `${colors.glow}, 0 4px 12px rgba(0,0,0,0.4)`
          : "0 4px 12px rgba(0,0,0,0.4)",
        position: "relative",
        transition: "all 0.3s ease",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: colors.dot, border: `2px solid ${colors.border}` }}
      />
      {data.label}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: colors.dot, border: `2px solid ${colors.border}` }}
      />
    </div>
  );
}
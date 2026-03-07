import { Handle, Position, type NodeProps } from "reactflow";
import { getNodeColors } from "../utils/nodeColors";

export default function IfNode({ data }: NodeProps) {
  const colors = getNodeColors(data.status);

  return (
    <div
      style={{
        width: 160,
        height: 140,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        filter: colors.glow !== "none"
          ? `drop-shadow(0 0 8px ${colors.border})`
          : "none",
        transition: "all 0.3s ease",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: colors.dot,
          border: `2px solid ${colors.border}`,
          top: "50%",
        }}
      />

      <svg width="140" height="140">
        <polygon
          points="70,0 140,70 70,140 0,70"
          fill={colors.background}
          stroke={colors.border}
          strokeWidth="2"
        />
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
        {data.label}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: colors.dot,
          border: `2px solid ${colors.border}`,
          top: "50%",
        }}
      />
    </div>
  );
}
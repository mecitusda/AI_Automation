import type { NodeFormProps } from "../types";

const sectionStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 4, fontSize: 13, color: "#9ca3af" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #374151", background: "#0b1220", color: "#e5e7eb", fontSize: 13 };

export default function DelayNodeForm({ params, onChange }: NodeFormProps) {
  const ms = Number(params?.ms ?? 1000);

  return (
    <div className="node-form node-form-delay">
      <div style={sectionStyle}>
        <label style={labelStyle}>Delay (ms)</label>
        <input
          type="number"
          min={0}
          value={ms}
          onChange={(e) => onChange({ ...params, ms: Number(e.target.value) })}
          style={inputStyle}
        />
      </div>
    </div>
  );
}

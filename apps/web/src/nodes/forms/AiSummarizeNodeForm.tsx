import { useEffect, useRef, useState } from "react";
import type { NodeFormProps } from "../types";
import VariableAutocomplete from "../../components/VariableAutocomplete";
import InsertVariableButton from "../../components/InsertVariableButton";
import FieldLabel from "../../components/FieldLabel";

const sectionStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 4, fontSize: 13, color: "#9ca3af" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #374151", background: "#0b1220", color: "#e5e7eb", fontSize: 13 };

export default function AiSummarizeNodeForm({ params, onChange, availablePaths = [], registerInsertHandler, availableVariableTree = [], examplePrompt, fieldHelp = {}, showInsertVariableButton = true }: NodeFormProps) {
  const text = String(params?.text ?? "");
  const maxLength = Number(params?.maxLength ?? 200);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const selectionRef = useRef(selection);
  const textRef = useRef(text);
  const paramsRef = useRef(params);
  const onChangeRef = useRef(onChange);
  const focusedRef = useRef(false);
  selectionRef.current = selection;
  textRef.current = text;
  paramsRef.current = params;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!registerInsertHandler) return;
    registerInsertHandler((path) => {
      if (!focusedRef.current) return;
      const inserted = `{{ ${path} }}`;
      const currentText = String(paramsRef.current?.text ?? "");
      const { start, end } = selectionRef.current;
      onChangeRef.current({ ...paramsRef.current, text: currentText.slice(0, start) + inserted + currentText.slice(end) });
    });
    return () => registerInsertHandler(null);
  }, [registerInsertHandler]);

  return (
    <div className="node-form node-form-ai-summarize">
      <div style={sectionStyle}>
        <FieldLabel style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }} help={fieldHelp.text}>
          Text (optional)
          {showInsertVariableButton && availableVariableTree.length > 0 && (
            <InsertVariableButton
              tree={availableVariableTree}
              onInsert={(path) => {
                const inserted = `{{ ${path} }}`;
                const { start, end } = selectionRef.current;
                onChange({ ...params, text: text.slice(0, start) + inserted + text.slice(end) });
              }}
            />
          )}
        </FieldLabel>
        <VariableAutocomplete
          value={text}
          onChange={(v) => onChange({ ...params, text: v })}
          availablePaths={availablePaths}
          availableVariableTree={availableVariableTree}
          placeholder="Leave empty to summarize previous step output"
          rows={3}
          onFocus={() => { focusedRef.current = true; }}
          onBlur={() => setTimeout(() => { focusedRef.current = false; }, 0)}
          onSelectionChange={(start, end) => setSelection({ start, end })}
        />
      </div>
      {examplePrompt && (
        <div style={sectionStyle}>
          <div style={{ ...labelStyle, marginBottom: 4 }}>Example</div>
          <pre style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "pre-wrap", margin: 0, padding: 8, background: "#0b1220", borderRadius: 6, border: "1px solid #374151" }}>
            {examplePrompt}
          </pre>
          <button
            type="button"
            onClick={() => onChange({ ...params, text: examplePrompt })}
            style={{ marginTop: 6, padding: "4px 10px", fontSize: 12, border: "1px solid #374151", borderRadius: 6, background: "#1f2937", color: "#93c5fd", cursor: "pointer" }}
          >
            Insert example
          </button>
        </div>
      )}
      <div style={sectionStyle}>
        <FieldLabel style={labelStyle} help={fieldHelp.maxLength}>
          Max length
        </FieldLabel>
        <input
          type="number"
          min={1}
          value={maxLength}
          onChange={(e) => onChange({ ...params, maxLength: Number(e.target.value) })}
          style={inputStyle}
        />
      </div>
    </div>
  );
}

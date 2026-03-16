import { useEffect, useRef, useState } from "react";
import type { NodeFormProps } from "../types";
import VariableAutocomplete from "../../components/VariableAutocomplete";
import InsertVariableButton from "../../components/InsertVariableButton";

const sectionStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 4, fontSize: 13, color: "#9ca3af" };

export default function LogNodeForm({ params, onChange, registerInsertHandler, availablePaths = [], availableVariableTree = [], showInsertVariableButton = true }: NodeFormProps) {
  const message = String(params?.message ?? "");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const selectionRef = useRef(selection);
  const paramsRef = useRef(params);
  const onChangeRef = useRef(onChange);
  const focusedRef = useRef(false);
  selectionRef.current = selection;
  paramsRef.current = params;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!registerInsertHandler) return;
    registerInsertHandler((path) => {
      if (!focusedRef.current) return;
      const text = `{{ ${path} }}`;
      const currentMessage = String(paramsRef.current?.message ?? "");
      const { start, end } = selectionRef.current;
      onChangeRef.current({ ...paramsRef.current, message: currentMessage.slice(0, start) + text + currentMessage.slice(end) });
    });
    return () => registerInsertHandler(null);
  }, [registerInsertHandler]);

  return (
    <div className="node-form node-form-log">
      <div style={sectionStyle}>
        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
          Message
          {showInsertVariableButton && availableVariableTree.length > 0 && (
            <InsertVariableButton
              tree={availableVariableTree}
              onInsert={(path) => {
                const text = `{{ ${path} }}`;
                const { start, end } = selectionRef.current;
                onChange({ ...params, message: message.slice(0, start) + text + message.slice(end) });
              }}
            />
          )}
        </label>
        <VariableAutocomplete
          value={message}
          onChange={(v) => onChange({ ...params, message: v })}
          availablePaths={availablePaths}
          availableVariableTree={availableVariableTree}
          placeholder="Log message. Use {{ variable.path }} for variables."
          rows={1}
          onFocus={() => { focusedRef.current = true; }}
          onBlur={() => setTimeout(() => { focusedRef.current = false; }, 0)}
          onSelectionChange={(start, end) => setSelection({ start, end })}
        />
      </div>
    </div>
  );
}

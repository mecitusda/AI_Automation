import { useState, useEffect, useRef } from "react";
import type { NodeFormProps } from "../types";
import VariableAutocomplete from "../../components/VariableAutocomplete";
import InsertVariableButton from "../../components/InsertVariableButton";
import FieldLabel from "../../components/FieldLabel";

const sectionStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 4, fontSize: 13, color: "#9ca3af" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #374151", background: "#0b1220", color: "#e5e7eb", fontSize: 13 };
const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer" };
const errorStyle: React.CSSProperties = { color: "#f87171", fontSize: 12, marginTop: 2 };

export default function IfNodeForm({ params, onChange, errors, availablePaths = [], registerInsertHandler, availableVariableTree = [], fieldHelp = {}, showInsertVariableButton = true, availableTargetSteps = [] }: NodeFormProps) {
  const condition = String(params?.condition ?? "{{ trigger.flag }}");
  const [conditionSelection, setConditionSelection] = useState({ start: 0, end: 0 });
  const conditionSelectionRef = useRef(conditionSelection);
  const paramsRef = useRef(params);
  const onChangeRef = useRef(onChange);
  const focusedRef = useRef(false);
  conditionSelectionRef.current = conditionSelection;
  paramsRef.current = params;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!registerInsertHandler) return;
    registerInsertHandler((path) => {
      if (!focusedRef.current) return;
      const text = `{{ ${path} }}`;
      const currentCondition = String(paramsRef.current?.condition ?? "{{ trigger.flag }}");
      const { start, end } = conditionSelectionRef.current;
      onChangeRef.current({ ...paramsRef.current, condition: currentCondition.slice(0, start) + text + currentCondition.slice(end) });
    });
    return () => registerInsertHandler(null);
  }, [registerInsertHandler]);

  const thenGoto = String(params?.thenGoto ?? "");
  const elseGoto = String(params?.elseGoto ?? "");

  const set = (key: string, value: unknown) => {
    onChange({ ...params, [key]: value });
  };

  return (
    <div className="node-form node-form-if">
      <div style={sectionStyle}>
        <FieldLabel style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }} help={fieldHelp.condition || "Put only the value in {{ }} and the comparison outside, e.g. {{ loop.item.amount }} > 800"}>
          Condition *
          {showInsertVariableButton && availableVariableTree.length > 0 && (
            <InsertVariableButton
              tree={availableVariableTree}
              onInsert={(path) => {
                const text = `{{ ${path} }}`;
                const { start, end } = conditionSelection;
                onChange({ ...params, condition: condition.slice(0, start) + text + condition.slice(end) });
              }}
            />
          )}
        </FieldLabel>
        <VariableAutocomplete
          value={condition}
          onChange={(v) => set("condition", v)}
          availablePaths={availablePaths}
          availableVariableTree={availableVariableTree}
          placeholder="{{ loop.item.amount }} > 800"
          rows={1}
          onFocus={() => { focusedRef.current = true; }}
          onBlur={() => setTimeout(() => { focusedRef.current = false; }, 0)}
          onSelectionChange={(start, end) => setConditionSelection({ start, end })}
        />
        {errors.condition && <div style={errorStyle}>{errors.condition}</div>}
      </div>
      <div style={sectionStyle}>
        <label style={labelStyle}>Then go to</label>
        <select
          value={thenGoto}
          onChange={(e) => set("thenGoto", e.target.value)}
          style={selectStyle}
          aria-label="Then go to (target step)"
        >
          <option value="">(None)</option>
          {availableTargetSteps.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label ?? s.id}
            </option>
          ))}
        </select>
      </div>
      <div style={sectionStyle}>
        <label style={labelStyle}>Else go to</label>
        <select
          value={elseGoto}
          onChange={(e) => set("elseGoto", e.target.value)}
          style={selectStyle}
          aria-label="Else go to (target step)"
        >
          <option value="">(None)</option>
          {availableTargetSteps.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label ?? s.id}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

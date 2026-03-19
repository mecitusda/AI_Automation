import { useState, useEffect, useRef } from "react";
import type { NodeFormProps } from "../types";
import VariableAutocomplete from "../../components/VariableAutocomplete";
import InsertVariableButton from "../../components/InsertVariableButton";
import FieldLabel from "../../components/FieldLabel";

const sectionStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 4, fontSize: 13, color: "#9ca3af" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #374151", background: "#0b1220", color: "#e5e7eb", fontSize: 13 };
const errorStyle: React.CSSProperties = { color: "#f87171", fontSize: 12, marginTop: 2 };

export default function ForeachNodeForm({ params, onChange, errors, availablePaths = [], registerInsertHandler, availableVariableTree = [], suggestedArrayPaths = [], fieldHelp = {}, showInsertVariableButton = true }: NodeFormProps) {
  const items = String(params?.items ?? "{{ trigger.items }}");
  const [itemsSelection, setItemsSelection] = useState({ start: 0, end: 0 });
  const itemsSelectionRef = useRef(itemsSelection);
  const paramsRef = useRef(params);
  const onChangeRef = useRef(onChange);
  const focusedRef = useRef(false);
  itemsSelectionRef.current = itemsSelection;
  paramsRef.current = params;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!registerInsertHandler) return;
    registerInsertHandler((path) => {
      if (!focusedRef.current) return;
      const text = `{{ ${path} }}`;
      const currentItems = String(paramsRef.current?.items ?? "{{ trigger.items }}");
      const { start, end } = itemsSelectionRef.current;
      onChangeRef.current({ ...paramsRef.current, items: currentItems.slice(0, start) + text + currentItems.slice(end) });
    });
    return () => registerInsertHandler(null);
  }, [registerInsertHandler]);

  const itemVariableName = String(params?.itemVariableName ?? "item");
  const parallel = params?.parallel === true;
  const continueOnError = params?.continueOnError !== false;
  const maxParallel = Number(params?.maxParallel ?? 0) || undefined;

  // Prefer run-based array paths when available; fallback to steps/trigger paths
  const arrayLikeSuggestions =
    suggestedArrayPaths.length > 0
      ? suggestedArrayPaths
      : availablePaths.filter((p) => p.startsWith("steps.") || p.startsWith("trigger."));
  const hasRunBasedSuggestions = suggestedArrayPaths.length > 0;

  const set = (key: string, value: unknown) => {
    onChange({ ...params, [key]: value });
  };

  return (
    <div className="node-form node-form-foreach">
      <div style={sectionStyle}>
        <FieldLabel style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }} help={fieldHelp.items}>
          Items path *
          {showInsertVariableButton && availableVariableTree.length > 0 && (
            <InsertVariableButton
              tree={availableVariableTree}
              onInsert={(path) => {
                const text = `{{ ${path} }}`;
                const { start, end } = itemsSelection;
                onChange({ ...params, items: items.slice(0, start) + text + items.slice(end) });
              }}
            />
          )}
        </FieldLabel>
        <VariableAutocomplete
          value={items}
          onChange={(v) => set("items", v)}
          availablePaths={availablePaths}
          availableVariableTree={availableVariableTree}
          placeholder="{{ trigger.items }} or {{ steps.fetchStep.output.data }}"
          rows={1}
          onFocus={() => { focusedRef.current = true; }}
          onBlur={() => setTimeout(() => { focusedRef.current = false; }, 0)}
          onSelectionChange={(start, end) => setItemsSelection({ start, end })}
        />
        {errors.items && <div style={errorStyle}>{errors.items}</div>}
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
          Must resolve to an array at runtime.
        </div>
        {arrayLikeSuggestions.length > 0 && (
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
            <div style={{ marginBottom: 2 }}>
              {hasRunBasedSuggestions ? "Suggested array sources (from latest run):" : "Suggestions (likely list outputs):"}
            </div>
            <ul style={{ margin: 0, paddingLeft: 14 }}>
              {arrayLikeSuggestions.slice(0, 5).map((p) => (
                <li key={p}>
                  <code>{`{{ ${p} }}`}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div style={sectionStyle}>
        <FieldLabel style={labelStyle} help={fieldHelp.itemVariableName}>
          Item variable name
        </FieldLabel>
        <input
          type="text"
          value={itemVariableName}
          onChange={(e) => set("itemVariableName", e.target.value)}
          placeholder="item"
          style={inputStyle}
        />
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>Use {"{{ loop.item }}"} in child steps.</div>
      </div>
      <div style={sectionStyle}>
        <FieldLabel style={labelStyle}>Continue on error</FieldLabel>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#e5e7eb" }}>
          <input
            type="checkbox"
            checked={continueOnError}
            onChange={(e) => set("continueOnError", e.target.checked ? true : false)}
            style={{ transform: "scale(1.05)" }}
          />
          <span>Continue to next item when a step fails (default: on)</span>
        </label>
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
          When enabled, a failed step in one iteration won&apos;t stop the loop; remaining items will still be processed.
        </div>
      </div>
      <div style={sectionStyle}>
        <FieldLabel style={labelStyle}>Parallel execution</FieldLabel>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#e5e7eb" }}>
          <input
            type="checkbox"
            checked={parallel}
            onChange={(e) => set("parallel", e.target.checked ? true : undefined)}
            style={{ transform: "scale(1.05)" }}
          />
          <span>Run foreach iterations concurrently (cap: workflow max parallel)</span>
        </label>
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
          When disabled, iterations run sequentially.
        </div>
      </div>
      <div style={sectionStyle}>
        <label style={labelStyle}>Max parallel override (optional)</label>
        <input
          type="number"
          min={0}
          value={maxParallel ?? 0}
          onChange={(e) => set("maxParallel", e.target.value ? Number(e.target.value) : undefined)}
          style={inputStyle}
        />
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
          If set, the engine will still cap concurrency by <code>workflow.maxParallel</code>.
        </div>
      </div>
    </div>
  );
}

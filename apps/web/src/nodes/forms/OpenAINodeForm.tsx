import { useEffect, useRef, useState } from "react";
import type { NodeFormProps } from "../types";
import VariableAutocomplete from "../../components/VariableAutocomplete";
import InsertVariableButton from "../../components/InsertVariableButton";
import FieldLabel from "../../components/FieldLabel";

const sectionStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 4, fontSize: 13, color: "#9ca3af" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #374151", background: "#0b1220", color: "#e5e7eb", fontSize: 13 };
const errorStyle: React.CSSProperties = { color: "#f87171", fontSize: 12, marginTop: 2 };

const MODELS = ["gpt-4", "gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"];

export default function OpenAINodeForm({ params, onChange, errors, availablePaths = [], registerInsertHandler, availableVariableTree = [], examplePrompt, fieldHelp = {}, showInsertVariableButton = true }: NodeFormProps) {
  const prompt = String(params?.prompt ?? "");
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
      const currentPrompt = String(paramsRef.current?.prompt ?? "");
      const { start, end } = selectionRef.current;
      const newPrompt = currentPrompt.slice(0, start) + text + currentPrompt.slice(end);
      onChangeRef.current({ ...paramsRef.current, prompt: newPrompt });
    });
    return () => registerInsertHandler(null);
  }, [registerInsertHandler]);
  const model = String(params?.model ?? "gpt-4");
  const temperature = Number(params?.temperature ?? 0.7);
  const maxTokens = Number(params?.maxTokens ?? 1024);
  const outputFormat = String(params?.output_format ?? "text");

  const set = (key: string, value: unknown) => {
    onChange({ ...params, [key]: value });
  };

  return (
    <div className="node-form node-form-openai">
      <div style={sectionStyle}>
        <FieldLabel style={labelStyle} help={fieldHelp.model}>
          Model
        </FieldLabel>
        <select value={model} onChange={(e) => set("model", e.target.value)} style={inputStyle}>
          {MODELS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      <div style={sectionStyle}>
        <FieldLabel style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }} help={fieldHelp.prompt}>
          Prompt *
          {showInsertVariableButton && availableVariableTree.length > 0 && (
            <InsertVariableButton
              tree={availableVariableTree}
              onInsert={(path) => {
                const text = `{{ ${path} }}`;
                const { start, end } = selectionRef.current;
                onChange({ ...params, prompt: prompt.slice(0, start) + text + prompt.slice(end) });
              }}
            />
          )}
        </FieldLabel>
        <VariableAutocomplete
          value={prompt}
          onChange={(v) => set("prompt", v)}
          availablePaths={availablePaths}
          availableVariableTree={availableVariableTree}
          placeholder="Enter your prompt. Use {{ variable.path }} for variables."
          rows={4}
          onFocus={() => { focusedRef.current = true; }}
          onBlur={() => setTimeout(() => { focusedRef.current = false; }, 0)}
          onSelectionChange={(start, end) => setSelection({ start, end })}
        />
        {errors.prompt && <div style={errorStyle}>{errors.prompt}</div>}
      </div>
      {examplePrompt && (
        <div style={sectionStyle}>
          <div style={{ ...labelStyle, marginBottom: 4 }}>Example</div>
          <pre style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "pre-wrap", margin: 0, padding: 8, background: "#0b1220", borderRadius: 6, border: "1px solid #374151" }}>
            {examplePrompt}
          </pre>
          <button
            type="button"
            onClick={() => set("prompt", examplePrompt)}
            style={{ marginTop: 6, padding: "4px 10px", fontSize: 12, border: "1px solid #374151", borderRadius: 6, background: "#1f2937", color: "#93c5fd", cursor: "pointer" }}
          >
            Insert example
          </button>
        </div>
      )}
      <div style={sectionStyle}>
        <FieldLabel style={labelStyle} help={fieldHelp.temperature}>
          Temperature
        </FieldLabel>
        <input
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          onChange={(e) => set("temperature", Number(e.target.value))}
          style={inputStyle}
        />
      </div>
      <div style={sectionStyle}>
        <FieldLabel style={labelStyle} help={fieldHelp.maxTokens}>
          Max tokens
        </FieldLabel>
        <input
          type="number"
          min={1}
          max={4096}
          value={maxTokens}
          onChange={(e) => set("maxTokens", Number(e.target.value))}
          style={inputStyle}
        />
      </div>
      <div style={sectionStyle}>
        <FieldLabel style={labelStyle} help={fieldHelp.output_format}>
          Output format
        </FieldLabel>
        <select value={outputFormat} onChange={(e) => set("output_format", e.target.value)} style={inputStyle}>
          <option value="text">Text</option>
          <option value="json">JSON</option>
          <option value="array">Array</option>
        </select>
      </div>
    </div>
  );
}

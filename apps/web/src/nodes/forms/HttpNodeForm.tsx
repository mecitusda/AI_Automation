import { useEffect, useRef, useState } from "react";
import type { NodeFormProps } from "../types";
import VariableAutocomplete from "../../components/VariableAutocomplete";
import InsertVariableButton from "../../components/InsertVariableButton";
import FieldLabel from "../../components/FieldLabel";

const sectionStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 4, fontSize: 13, color: "#9ca3af" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #374151", background: "#0b1220", color: "#e5e7eb", fontSize: 13 };
const errorStyle: React.CSSProperties = { color: "#f87171", fontSize: 12, marginTop: 2 };

export default function HttpNodeForm({ params, onChange, errors, availablePaths = [], registerInsertHandler, availableVariableTree = [], fieldHelp = {}, showInsertVariableButton = true }: NodeFormProps) {
  const url = String(params?.url ?? "");
  const method = String(params?.method ?? "GET");
  const body = typeof params?.body === "string" ? params.body : JSON.stringify(params?.body ?? {}, null, 2);
  const timeout = Number(params?.timeout ?? 0);
  const headers = (params?.headers as Record<string, string>) ?? {};
  const [focusedField, setFocusedField] = useState<"url" | "body" | null>(null);
  const [bodyJsonError, setBodyJsonError] = useState<string | null>(null);
  const [urlSelection, setUrlSelection] = useState({ start: 0, end: 0 });
  const [bodySelection, setBodySelection] = useState({ start: 0, end: 0 });
  const urlSelectionRef = useRef(urlSelection);
  const bodySelectionRef = useRef(bodySelection);
  const focusedFieldRef = useRef(focusedField);
  urlSelectionRef.current = urlSelection;
  bodySelectionRef.current = bodySelection;
  focusedFieldRef.current = focusedField;

  useEffect(() => {
    if (!registerInsertHandler) return;
    registerInsertHandler((path) => {
      const text = `{{ ${path} }}`;
      const field = focusedFieldRef.current;
      if (field === "url") {
        const { start, end } = urlSelectionRef.current;
        onChange({ ...params, url: url.slice(0, start) + text + url.slice(end) });
      } else if (field === "body") {
        const { start, end } = bodySelectionRef.current;
        const newBody = body.slice(0, start) + text + body.slice(end);
        try {
          const parsed = newBody.trim() ? JSON.parse(newBody) : undefined;
          setBodyJsonError(null);
          onChange({ ...params, body: parsed });
        } catch (e: unknown) {
          setBodyJsonError("Invalid JSON (HTTP body)");
          onChange({ ...params, body: newBody });
        }
      }
    });
    return () => registerInsertHandler(null);
  }, [registerInsertHandler, url, body, params, onChange]);

  const set = (key: string, value: unknown) => {
    onChange({ ...params, [key]: value });
  };

  const setHeader = (k: string, v: string) => {
    const next = { ...headers };
    if (v === "") delete next[k];
    else next[k] = v;
    set("headers", next);
  };

  const headerEntries = Object.entries(headers);
  return (
    <div className="node-form node-form-http">
      <div style={sectionStyle}>
        <FieldLabel style={labelStyle} help={fieldHelp.method}>Method</FieldLabel>
        <select
          value={method}
          onChange={(e) => set("method", e.target.value)}
          style={inputStyle}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="DELETE">DELETE</option>
        </select>
      </div>
      <div style={sectionStyle}>
        <FieldLabel style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }} help={fieldHelp.url}>
          URL *
          {showInsertVariableButton && availableVariableTree.length > 0 && (
            <InsertVariableButton
              tree={availableVariableTree}
              onInsert={(path) => {
                const inserted = `{{ ${path} }}`;
                const { start, end } = urlSelectionRef.current;
                onChange({ ...params, url: url.slice(0, start) + inserted + url.slice(end) });
              }}
            />
          )}
        </FieldLabel>
        <VariableAutocomplete
          value={url}
          onChange={(v) => set("url", v)}
          availablePaths={availablePaths}
          availableVariableTree={availableVariableTree}
          placeholder="https://api.example.com/..."
          rows={1}
          onFocus={() => setFocusedField("url")}
          onBlur={() => setTimeout(() => setFocusedField(null), 0)}
          onSelectionChange={(start, end) => setUrlSelection({ start, end })}
        />
        {errors.url && <div style={errorStyle}>{errors.url}</div>}
      </div>
      <div style={sectionStyle}>
        <label style={labelStyle}>Headers (key-value)</label>
        {headerEntries.map(([k, v]) => (
          <div key={k} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            <input
              type="text"
              value={k}
              onChange={(e) => { setHeader(k, ""); setHeader(e.target.value, v); }}
              placeholder="Key"
              style={{ ...inputStyle, flex: 1 }}
            />
            <input
              type="text"
              value={v}
              onChange={(e) => setHeader(k, e.target.value)}
              placeholder="Value"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="button" onClick={() => setHeader(k, "")} style={{ padding: "4px 8px" }}>Remove</button>
          </div>
        ))}
        <button type="button" onClick={() => set("headers", { ...headers, "": "" })} style={{ padding: "4px 8px", marginTop: 4 }}>+ Add header</button>
      </div>
      <div style={sectionStyle}>
        <FieldLabel style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }} help={fieldHelp.body}>
          Body (JSON)
          {showInsertVariableButton && availableVariableTree.length > 0 && (
            <InsertVariableButton
              tree={availableVariableTree}
              onInsert={(path) => {
                const inserted = `{{ ${path} }}`;
                const { start, end } = bodySelectionRef.current;
                const newBody = body.slice(0, start) + inserted + body.slice(end);
                try {
                  onChange({ ...params, body: newBody.trim() ? JSON.parse(newBody) : undefined });
                  setBodyJsonError(null);
                } catch {
                  setBodyJsonError("Invalid JSON (HTTP body)");
                  onChange({ ...params, body: newBody });
                }
              }}
            />
          )}
        </FieldLabel>
        <VariableAutocomplete
          value={body}
          availablePaths={availablePaths}
          availableVariableTree={availableVariableTree}
          onChange={(v) => {
            try {
              const parsed = v.trim() ? JSON.parse(v) : undefined;
              setBodyJsonError(null);
              set("body", parsed);
            } catch (e: unknown) {
              setBodyJsonError("Invalid JSON (HTTP body)");
              set("body", v);
            }
          }}
          rows={4}
          placeholder="{}"
          onFocus={() => setFocusedField("body")}
          onBlur={() => setTimeout(() => setFocusedField(null), 0)}
          onSelectionChange={(start, end) => setBodySelection({ start, end })}
        />
        {bodyJsonError && <div style={errorStyle}>{bodyJsonError}</div>}
        {errors?.body && <div style={errorStyle}>{errors.body}</div>}
      </div>
      <div style={sectionStyle}>
        <label style={labelStyle}>Timeout (ms)</label>
        <input
          type="number"
          min={0}
          value={timeout}
          onChange={(e) => set("timeout", Number(e.target.value))}
          style={inputStyle}
        />
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { PluginSchemaField } from "../api/plugins";
import type { VariableTreeNode } from "../utils/variableSystem";
import FieldLabel from "./FieldLabel";
import VariableAutocomplete from "./VariableAutocomplete";

const sectionStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 4, fontSize: 13, color: "#9ca3af" };
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid #374151",
  background: "#0b1220",
  color: "#e5e7eb",
  fontSize: 13,
};
const errorStyle: React.CSSProperties = { color: "#f87171", fontSize: 12, marginTop: 2 };

export type SchemaFormProps = {
  schema: PluginSchemaField[];
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  errors: Record<string, string>;
  registerInsertHandler?: (handler: ((path: string) => void) | null) => void;
  availablePaths?: string[];
  availableVariableTree?: VariableTreeNode[];
  disabled?: boolean;
};

export default function SchemaForm({
  schema,
  params,
  onChange,
  errors,
  registerInsertHandler,
  availablePaths = [],
  availableVariableTree = [],
  disabled = false,
}: SchemaFormProps) {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const selectionRef = useRef(selection);
  const focusedKeyRef = useRef<string | null>(null);
  const paramsRef = useRef(params);
  const onChangeRef = useRef(onChange);

  selectionRef.current = selection;
  focusedKeyRef.current = focusedKey;
  paramsRef.current = params;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!registerInsertHandler) return;
    registerInsertHandler((path) => {
      const key = focusedKeyRef.current;
      if (key == null) return;
      const text = `{{ ${path} }}`;
      const currentParams = paramsRef.current;
      const val = currentParams[key];
      const str = typeof val === "string" ? val : JSON.stringify(val ?? "");
      const { start, end } = selectionRef.current;
      const newStr = str.slice(0, start) + text + str.slice(end);
      onChangeRef.current({ ...currentParams, [key]: newStr });
    });
    return () => registerInsertHandler(null);
  }, [registerInsertHandler]);

  const set = (key: string, value: unknown) => {
    onChange({ ...params, [key]: value });
  };

  if (!schema || schema.length === 0) {
    return (
      <div className="node-form node-form-schema">
        <p style={{ color: "#9ca3af", fontSize: 13 }}>No parameters defined for this step.</p>
      </div>
    );
  }

  return (
    <div className="node-form node-form-schema">
      {schema.map((field) => {
        const value = params?.[field.key];

        if (field.type === "string") {
          return (
            <div key={field.key} style={sectionStyle}>
              <FieldLabel style={labelStyle}>
                {field.label}
                {field.required && " *"}
              </FieldLabel>
              <input
                type="text"
                value={String(value ?? field.default ?? "")}
                onChange={(e) => set(field.key, e.target.value)}
                placeholder={field.placeholder}
                disabled={disabled}
                onFocus={() => setFocusedKey(field.key)}
                onBlur={() => setTimeout(() => setFocusedKey(null), 0)}
                onSelect={(e) => {
                  const t = e.target as HTMLInputElement;
                  setSelection({ start: t.selectionStart ?? 0, end: t.selectionEnd ?? 0 });
                }}
                onKeyUp={(e) => {
                  const t = e.target as HTMLInputElement;
                  setSelection({ start: t.selectionStart ?? 0, end: t.selectionEnd ?? 0 });
                }}
                style={inputStyle}
              />
              {errors[field.key] && <div style={errorStyle}>{errors[field.key]}</div>}
            </div>
          );
        }

        if (field.type === "variable") {
          return (
            <div key={field.key} style={sectionStyle}>
              <FieldLabel style={labelStyle}>
                {field.label}
                {field.required && " *"}
              </FieldLabel>
              <VariableAutocomplete
                value={String(value ?? field.default ?? "")}
                onChange={(v) => set(field.key, v)}
                availablePaths={availablePaths}
                availableVariableTree={availableVariableTree}
                onSelectionChange={(start, end) => setSelection({ start, end })}
                onFocus={() => setFocusedKey(field.key)}
                onBlur={() => setTimeout(() => setFocusedKey(null), 0)}
              />
              {errors[field.key] && <div style={errorStyle}>{errors[field.key]}</div>}
            </div>
          );
        }

        if (field.type === "number") {
          return (
            <div key={field.key} style={sectionStyle}>
              <FieldLabel style={labelStyle}>
                {field.label}
                {field.required && " *"}
              </FieldLabel>
              <input
                type="number"
                value={value !== undefined && value !== null ? Number(value) : (field.default as number) ?? ""}
                onChange={(e) => set(field.key, e.target.value === "" ? undefined : Number(e.target.value))}
                placeholder={field.placeholder}
                disabled={disabled}
                style={inputStyle}
              />
              {errors[field.key] && <div style={errorStyle}>{errors[field.key]}</div>}
            </div>
          );
        }

        if (field.type === "boolean") {
          return (
            <div key={field.key} style={sectionStyle}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(value ?? field.default ?? false)}
                  onChange={(e) => set(field.key, e.target.checked)}
                  disabled={disabled}
                />
                <span style={labelStyle}>{field.label}</span>
              </label>
              {errors[field.key] && <div style={errorStyle}>{errors[field.key]}</div>}
            </div>
          );
        }

        if (field.type === "select") {
          const options = field.options ?? [];
          return (
            <div key={field.key} style={sectionStyle}>
              <FieldLabel style={labelStyle}>
                {field.label}
                {field.required && " *"}
              </FieldLabel>
              <select
                value={String(value ?? field.default ?? "")}
                onChange={(e) => set(field.key, e.target.value)}
                disabled={disabled}
                style={inputStyle}
              >
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {errors[field.key] && <div style={errorStyle}>{errors[field.key]}</div>}
            </div>
          );
        }

        if (field.type === "json" || field.type === "code") {
          const raw = typeof value === "string" ? value : JSON.stringify(value ?? field.default ?? {}, null, 2);
          return (
            <div key={field.key} style={sectionStyle}>
              <FieldLabel style={labelStyle}>
                {field.label}
                {field.required && " *"}
              </FieldLabel>
              <VariableAutocomplete
                value={raw}
                onChange={(v) => {
                  try {
                    const parsed = v.trim() ? JSON.parse(v) : {};
                    set(field.key, parsed);
                  } catch {
                    set(field.key, v);
                  }
                }}
                availablePaths={availablePaths}
                availableVariableTree={availableVariableTree}
                rows={field.type === "code" ? 12 : 6}
                onSelectionChange={(start, end) => setSelection({ start, end })}
                onFocus={() => setFocusedKey(field.key)}
                onBlur={() => setTimeout(() => setFocusedKey(null), 0)}
              />
              {errors[field.key] && <div style={errorStyle}>{errors[field.key]}</div>}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

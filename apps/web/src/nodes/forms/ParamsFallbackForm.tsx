import { useState, useEffect, useRef } from "react";
import type { NodeFormProps } from "../types";
import VariableAutocomplete from "../../components/VariableAutocomplete";

export default function ParamsFallbackForm({
  params,
  onChange,
  errors,
  registerInsertHandler,
  availablePaths = [],
  availableVariableTree = [],
}: NodeFormProps) {
  const paramsText = JSON.stringify(params ?? {}, null, 2);
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
      const raw = JSON.stringify(paramsRef.current ?? {}, null, 2);
      const { start, end } = selectionRef.current;
      const newRaw = raw.slice(0, start) + text + raw.slice(end);
      try {
        const next = JSON.parse(newRaw);
        onChangeRef.current(next);
      } catch {
        // keep as-is on parse error
      }
    });
    return () => registerInsertHandler(null);
  }, [registerInsertHandler]);

  const handleChange = (newValue: string) => {
    try {
      const next = newValue.trim() ? JSON.parse(newValue) : {};
      onChange(next);
    } catch {
      // leave as-is on parse error
    }
  };

  return (
    <div className="node-form-fallback">
      <label>
        <strong>Params (JSON)</strong>
        {errors.params && (
          <span className="form-error">{errors.params}</span>
        )}
      </label>
      <VariableAutocomplete
        value={paramsText}
        onChange={handleChange}
        availablePaths={availablePaths}
        availableVariableTree={availableVariableTree}
        rows={10}
        onFocus={() => { focusedRef.current = true; }}
        onBlur={() => setTimeout(() => { focusedRef.current = false; }, 0)}
        onSelectionChange={(start, end) => setSelection({ start, end })}
      />
    </div>
  );
}

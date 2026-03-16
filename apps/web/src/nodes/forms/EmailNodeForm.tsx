import { useEffect, useRef, useState } from "react";
import type { NodeFormProps } from "../types";
import VariableAutocomplete from "../../components/VariableAutocomplete";
import InsertVariableButton from "../../components/InsertVariableButton";

const sectionStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 4, fontSize: 13, color: "#9ca3af" };
const errorStyle: React.CSSProperties = { color: "#f87171", fontSize: 12, marginTop: 2 };

export default function EmailNodeForm({ params, onChange, errors, availablePaths = [], registerInsertHandler, availableVariableTree = [], showInsertVariableButton = true }: NodeFormProps) {
  const to = String(params?.to ?? "");
  const subject = String(params?.subject ?? "");
  const body = String(params?.body ?? "");
  const [focusedField, setFocusedField] = useState<"to" | "subject" | "body" | null>(null);
  const [toSelection, setToSelection] = useState({ start: 0, end: 0 });
  const [subjectSelection, setSubjectSelection] = useState({ start: 0, end: 0 });
  const [bodySelection, setBodySelection] = useState({ start: 0, end: 0 });
  const toSelectionRef = useRef(toSelection);
  const subjectSelectionRef = useRef(subjectSelection);
  const bodySelectionRef = useRef(bodySelection);
  const focusedFieldRef = useRef(focusedField);
  toSelectionRef.current = toSelection;
  subjectSelectionRef.current = subjectSelection;
  bodySelectionRef.current = bodySelection;
  focusedFieldRef.current = focusedField;

  useEffect(() => {
    if (!registerInsertHandler) return;
    registerInsertHandler((path) => {
      const inserted = `{{ ${path} }}`;
      const field = focusedFieldRef.current;
      if (field === "to") {
        const { start, end } = toSelectionRef.current;
        onChange({ ...params, to: to.slice(0, start) + inserted + to.slice(end) });
      } else if (field === "subject") {
        const { start, end } = subjectSelectionRef.current;
        onChange({ ...params, subject: subject.slice(0, start) + inserted + subject.slice(end) });
      } else if (field === "body") {
        const { start, end } = bodySelectionRef.current;
        onChange({ ...params, body: body.slice(0, start) + inserted + body.slice(end) });
      }
    });
    return () => registerInsertHandler(null);
  }, [registerInsertHandler, to, subject, body, params, onChange]);

  const set = (key: string, value: unknown) => {
    onChange({ ...params, [key]: value });
  };

  return (
    <div className="node-form node-form-email">
      <div style={sectionStyle}>
        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
          To *
          {showInsertVariableButton && availableVariableTree.length > 0 && (
            <InsertVariableButton
              tree={availableVariableTree}
              onInsert={(path) => {
                const inserted = `{{ ${path} }}`;
                const { start, end } = toSelectionRef.current;
                onChange({ ...params, to: to.slice(0, start) + inserted + to.slice(end) });
              }}
            />
          )}
        </label>
        <VariableAutocomplete
          value={to}
          onChange={(v) => set("to", v)}
          availablePaths={availablePaths}
          availableVariableTree={availableVariableTree}
          placeholder="user@example.com"
          rows={1}
          onFocus={() => setFocusedField("to")}
          onBlur={() => setTimeout(() => setFocusedField(null), 0)}
          onSelectionChange={(start, end) => setToSelection({ start, end })}
        />
        {errors.to && <div style={errorStyle}>{errors.to}</div>}
      </div>
      <div style={sectionStyle}>
        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
          Subject
          {showInsertVariableButton && availableVariableTree.length > 0 && (
            <InsertVariableButton
              tree={availableVariableTree}
              onInsert={(path) => {
                const inserted = `{{ ${path} }}`;
                const { start, end } = subjectSelectionRef.current;
                onChange({ ...params, subject: subject.slice(0, start) + inserted + subject.slice(end) });
              }}
            />
          )}
        </label>
        <VariableAutocomplete
          value={subject}
          onChange={(v) => set("subject", v)}
          availablePaths={availablePaths}
          availableVariableTree={availableVariableTree}
          rows={1}
          onFocus={() => setFocusedField("subject")}
          onBlur={() => setTimeout(() => setFocusedField(null), 0)}
          onSelectionChange={(start, end) => setSubjectSelection({ start, end })}
        />
      </div>
      <div style={sectionStyle}>
        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
          Body
          {showInsertVariableButton && availableVariableTree.length > 0 && (
            <InsertVariableButton
              tree={availableVariableTree}
              onInsert={(path) => {
                const inserted = `{{ ${path} }}`;
                const { start, end } = bodySelectionRef.current;
                onChange({ ...params, body: body.slice(0, start) + inserted + body.slice(end) });
              }}
            />
          )}
        </label>
        <VariableAutocomplete
          value={body}
          onChange={(v) => set("body", v)}
          availablePaths={availablePaths}
          availableVariableTree={availableVariableTree}
          rows={3}
          onFocus={() => setFocusedField("body")}
          onBlur={() => setTimeout(() => setFocusedField(null), 0)}
          onSelectionChange={(start, end) => setBodySelection({ start, end })}
        />
      </div>
    </div>
  );
}

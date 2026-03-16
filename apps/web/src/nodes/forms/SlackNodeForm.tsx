import { useEffect, useRef, useState } from "react";
import type { NodeFormProps } from "../types";
import VariableAutocomplete from "../../components/VariableAutocomplete";
import InsertVariableButton from "../../components/InsertVariableButton";

const sectionStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 4, fontSize: 13, color: "#9ca3af" };
const errorStyle: React.CSSProperties = { color: "#f87171", fontSize: 12, marginTop: 2 };

export default function SlackNodeForm({ params, onChange, errors, availablePaths = [], registerInsertHandler, availableVariableTree = [], showInsertVariableButton = true }: NodeFormProps) {
  const channel = String(params?.channel ?? "");
  const text = String(params?.text ?? "");
  const [focusedField, setFocusedField] = useState<"channel" | "text" | null>(null);
  const [channelSelection, setChannelSelection] = useState({ start: 0, end: 0 });
  const [textSelection, setTextSelection] = useState({ start: 0, end: 0 });
  const channelSelectionRef = useRef(channelSelection);
  const textSelectionRef = useRef(textSelection);
  const focusedFieldRef = useRef(focusedField);
  channelSelectionRef.current = channelSelection;
  textSelectionRef.current = textSelection;
  focusedFieldRef.current = focusedField;

  useEffect(() => {
    if (!registerInsertHandler) return;
    registerInsertHandler((path) => {
      const inserted = `{{ ${path} }}`;
      const field = focusedFieldRef.current;
      if (field === "channel") {
        const { start, end } = channelSelectionRef.current;
        onChange({ ...params, channel: channel.slice(0, start) + inserted + channel.slice(end) });
      } else if (field === "text") {
        const { start, end } = textSelectionRef.current;
        onChange({ ...params, text: text.slice(0, start) + inserted + text.slice(end) });
      }
    });
    return () => registerInsertHandler(null);
  }, [registerInsertHandler, channel, text, params, onChange]);

  const set = (key: string, value: unknown) => {
    onChange({ ...params, [key]: value });
  };

  return (
    <div className="node-form node-form-slack">
      <div style={sectionStyle}>
        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
          Channel *
          {showInsertVariableButton && availableVariableTree.length > 0 && (
            <InsertVariableButton
              tree={availableVariableTree}
              onInsert={(path) => {
                const inserted = `{{ ${path} }}`;
                const { start, end } = channelSelectionRef.current;
                onChange({ ...params, channel: channel.slice(0, start) + inserted + channel.slice(end) });
              }}
            />
          )}
        </label>
        <VariableAutocomplete
          value={channel}
          onChange={(v) => set("channel", v)}
          availablePaths={availablePaths}
          availableVariableTree={availableVariableTree}
          placeholder="#general"
          rows={1}
          onFocus={() => setFocusedField("channel")}
          onBlur={() => setTimeout(() => setFocusedField(null), 0)}
          onSelectionChange={(start, end) => setChannelSelection({ start, end })}
        />
        {errors.channel && <div style={errorStyle}>{errors.channel}</div>}
      </div>
      <div style={sectionStyle}>
        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
          Text
          {showInsertVariableButton && availableVariableTree.length > 0 && (
            <InsertVariableButton
              tree={availableVariableTree}
              onInsert={(path) => {
                const inserted = `{{ ${path} }}`;
                const { start, end } = textSelectionRef.current;
                onChange({ ...params, text: text.slice(0, start) + inserted + text.slice(end) });
              }}
            />
          )}
        </label>
        <VariableAutocomplete
          value={text}
          onChange={(v) => set("text", v)}
          availablePaths={availablePaths}
          availableVariableTree={availableVariableTree}
          placeholder="Message. Use {{ variable.path }} for variables."
          rows={3}
          onFocus={() => setFocusedField("text")}
          onBlur={() => setTimeout(() => setFocusedField(null), 0)}
          onSelectionChange={(start, end) => setTextSelection({ start, end })}
        />
      </div>
    </div>
  );
}

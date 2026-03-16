import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import VariableHighlightedTextarea from "./VariableHighlightedTextarea";
import { getChildrenAtPath } from "../utils/variableSystem";
import type { VariableTreeNode } from "../utils/variableSystem";

type VariableAutocompleteProps = {
  value: string;
  onChange: (value: string) => void;
  availablePaths: string[];
  /** Optional tree for progressive segment suggestions (e.g. steps.fetchPost → output → data). */
  availableVariableTree?: VariableTreeNode[];
  placeholder?: string;
  rows?: number;
  className?: string;
  style?: React.CSSProperties;
  onFocus?: React.FocusEventHandler<HTMLTextAreaElement>;
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>;
  /** Notify parent of selection change (for insert-at-cursor from variable tree) */
  onSelectionChange?: (start: number, end: number) => void;
  /** Optional callbacks for variable hover/click inside the textarea. */
  onVariableHover?: (path: string | null) => void;
  onVariableClick?: (path: string) => void;
};

function getFilterAndOpenIndex(value: string, cursorPosition: number): { filter: string; openIndex: number } | null {
  const beforeCursor = value.slice(0, cursorPosition);
  const lastOpen = beforeCursor.lastIndexOf("{{");
  if (lastOpen === -1) return null;
  const afterOpen = beforeCursor.slice(lastOpen + 2);
  const closeInBetween = afterOpen.indexOf("}}");
  if (closeInBetween !== -1) return null;
  const filter = afterOpen.trimStart();
  return { filter, openIndex: lastOpen };
}

/** One suggestion: either a full path to insert or a segment to append (branch). */
type Suggestion = { type: "path"; path: string } | { type: "segment"; label: string; prefix: string };

export default function VariableAutocomplete({
  value,
  onChange,
  availablePaths,
  availableVariableTree = [],
  placeholder,
  rows = 3,
  className,
  style,
  onFocus,
  onBlur,
  onSelectionChange,
  onVariableHover,
  onVariableClick,
}: VariableAutocompleteProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState("");
  const [openIndex, setOpenIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const pathPrefix = filter.trim();

  const suggestions = useMemo((): Suggestion[] => {
    if (availableVariableTree.length > 0) {
      const children = getChildrenAtPath(availableVariableTree, pathPrefix);
      return children.map((node) => {
        if (node.path) return { type: "path" as const, path: node.path };
        return {
          type: "segment" as const,
          label: node.name,
          prefix: pathPrefix ? `${pathPrefix}.${node.name}` : node.name,
        };
      });
    }
    return availablePaths
      .filter((path) => !pathPrefix || path.toLowerCase().includes(pathPrefix.toLowerCase()))
      .map((path) => ({ type: "path" as const, path }));
  }, [availableVariableTree, pathPrefix, availablePaths]);

  const selectedSuggestion = suggestions[selectedIndex] ?? null;

  const insertAtCursor = useCallback(
    (path: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = openIndex;
      const end = value.indexOf("}}", start) !== -1 ? value.indexOf("}}", start) + 2 : value.length;
      const before = value.slice(0, start);
      const after = value.slice(end);
      const inserted = `{{ ${path} }}`;
      const newValue = before + inserted + after;
      onChange(newValue);
      setShowDropdown(false);
      setTimeout(() => {
        textarea.focus();
        const pos = start + inserted.length;
        textarea.setSelectionRange(pos, pos);
      }, 0);
    },
    [value, openIndex, onChange]
  );

  const appendSegment = useCallback(
    (prefix: string) => {
      const start = openIndex;
      const end = value.indexOf("}}", start) !== -1 ? value.indexOf("}}", start) + 2 : value.length;
      const before = value.slice(0, start);
      const after = value.slice(end);
      const inserted = `{{ ${prefix}.`;
      const newValue = before + inserted + after;
      onChange(newValue);
      setFilter(prefix);
      setSelectedIndex(0);
      setTimeout(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.focus();
          const pos = start + inserted.length;
          textarea.setSelectionRange(pos, pos);
        }
      }, 0);
    },
    [value, openIndex, onChange]
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [pathPrefix]);

  const handleChange = (newValue: string) => {
    onChange(newValue);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      const cursor = textarea?.selectionStart ?? newValue.length;
      const result = getFilterAndOpenIndex(newValue, cursor);
      if (result) {
        setFilter(result.filter);
        setOpenIndex(result.openIndex);
        setShowDropdown(true);
      } else {
        setShowDropdown(false);
      }
    });
  };

  const handleSelectSuggestion = (s: Suggestion) => {
    if (s.type === "path") {
      insertAtCursor(s.path);
    } else {
      appendSegment(s.prefix);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showDropdown || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % suggestions.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (e.key === "Enter" && selectedSuggestion) {
      e.preventDefault();
      handleSelectSuggestion(selectedSuggestion);
      return;
    }
    if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={{ position: "relative", ...style }} className={className}>
      <VariableHighlightedTextarea
        inputRef={textareaRef}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        rows={rows}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        onSelect={(e) => {
          const t = e.target as HTMLTextAreaElement;
          onSelectionChange?.(t.selectionStart ?? 0, t.selectionEnd ?? 0);
        }}
        onVariableHover={onVariableHover}
        onVariableClick={onVariableClick}
        style={{ width: "100%" }}
      />
      {/* Pass ref to the inner textarea - VariableHighlightedTextarea doesn't forward ref, so we need to get the textarea ref. For now we'll use a wrapper that forwards ref or use a callback ref. */}
      {/* Actually we need the textarea ref for setSelectionRange and focus. VariableHighlightedTextarea uses an internal textarea ref. We need to either forward ref from VariableHighlightedTextarea or use a different approach. Let me add a ref callback prop to VariableHighlightedTextarea. */}
      {showDropdown && (
        <ul
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "100%",
            margin: 0,
            marginTop: 4,
            padding: 4,
            listStyle: "none",
            maxHeight: 160,
            overflowY: "auto",
            background: "#111827",
            border: "1px solid #374151",
            borderRadius: 8,
            zIndex: 50,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          {suggestions.length === 0 ? (
            <li style={{ padding: "8px 10px", fontSize: 12, color: "#9ca3af" }}>No variables match</li>
          ) : (
            suggestions.map((s, i) => {
              const label = s.type === "path" ? s.path : s.label;
              const key = s.type === "path" ? s.path : `seg-${s.prefix}`;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => handleSelectSuggestion(s)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "6px 10px",
                      border: "none",
                      background: i === selectedIndex ? "rgba(59, 130, 246, 0.25)" : "transparent",
                      color: "#e5e7eb",
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: "monospace",
                      borderRadius: 4,
                    }}
                  >
                    {label}
                    {s.type === "segment" && " …"}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

import { useRef, useEffect, useCallback } from "react";

const VARIABLE_REGEX = /\{\{\s*[^}]+?\s*\}\}/g;

type VariableHighlightedTextareaProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  style?: React.CSSProperties;
  onFocus?: React.FocusEventHandler<HTMLTextAreaElement>;
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onSelect?: React.ReactEventHandler<HTMLTextAreaElement>;
  disabled?: boolean;
  /** Optional ref to get the underlying textarea (e.g. for focus/selection from parent) */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  /** Optional callbacks for variable hover and click inside the overlay. */
  onVariableHover?: (path: string | null) => void;
  onVariableClick?: (path: string) => void;
};

/**
 * Renders the same text as the textarea with {{ variable }} segments highlighted.
 */
function HighlightOverlay({
  value,
  onVariableHover,
  onVariableClick,
}: {
  value: string;
  onVariableHover?: (path: string | null) => void;
  onVariableClick?: (path: string) => void;
}) {
  const parts: { type: "text" | "variable"; value: string }[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(VARIABLE_REGEX.source, "g");
  while ((m = re.exec(value)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: "text", value: value.slice(lastIndex, m.index) });
    }
    parts.push({ type: "variable", value: m[0] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < value.length) {
    parts.push({ type: "text", value: value.slice(lastIndex) });
  }

  return (
    <div
      className="variable-highlight-overlay"
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        padding: "10px 12px",
        font: "inherit",
        fontSize: "inherit",
        lineHeight: "inherit",
        fontFamily: "inherit",
        whiteSpace: "pre-wrap",
        wordWrap: "break-word",
        overflow: "hidden",
        pointerEvents: "none",
        color: "#e5e7eb",
        overflowY: "auto",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      } as React.CSSProperties}
    >
      {parts.map((part, i) =>
        part.type === "variable" ? (
          <span
            key={i}
            className="variable-chunk"
            onMouseEnter={() => onVariableHover?.(part.value)}
            onMouseLeave={() => onVariableHover?.(null)}
            onClick={() => onVariableClick?.(part.value)}
          >
            {part.value}
          </span>
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </div>
  );
}

export default function VariableHighlightedTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  className,
  style,
  onFocus,
  onBlur,
  onKeyDown,
  onSelect,
  disabled,
  inputRef,
  onVariableHover,
  onVariableClick,
}: VariableHighlightedTextareaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
      if (inputRef) (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
    },
    [inputRef]
  );

  useEffect(() => {
    const container = containerRef.current;
    const textarea = textareaRef.current;
    if (!container || !textarea) return;
    const syncScroll = () => {
      const overlay = container.querySelector(".variable-highlight-overlay");
      if (overlay) (overlay as HTMLElement).scrollTop = textarea.scrollTop;
    };
    textarea.addEventListener("scroll", syncScroll);
    return () => textarea.removeEventListener("scroll", syncScroll);
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", ...style }}
    >
      <HighlightOverlay
        value={value}
        onVariableHover={onVariableHover}
        onVariableClick={onVariableClick}
      />
      <textarea
        ref={setRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onSelect={onSelect}
        disabled={disabled}
        spellCheck={false}
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          minHeight: "inherit",
          padding: "10px 12px",
          background: "transparent",
          color: "transparent",
          caretColor: "#e5e7eb",
          border: "1px solid #374151",
          borderRadius: 8,
          font: "inherit",
          fontSize: "inherit",
          lineHeight: "inherit",
          fontFamily: "inherit",
          resize: "vertical",
        }}
      />
    </div>
  );
}

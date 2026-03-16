import { useState, useRef, useEffect } from "react";

type FieldLabelProps = {
  htmlFor?: string;
  children: React.ReactNode;
  help?: string;
  style?: React.CSSProperties;
};

export default function FieldLabel({ htmlFor, children, help, style }: FieldLabelProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!showTooltip || !help) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowTooltip(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showTooltip, help]);

  return (
    <label htmlFor={htmlFor} style={style}>
      {children}
      {help && (
        <span ref={ref} style={{ position: "relative", marginLeft: 4, cursor: "help" }}>
          <span
            role="button"
            tabIndex={0}
            aria-label="Help"
            onClick={() => setShowTooltip((s) => !s)}
            onKeyDown={(e) => e.key === "Enter" && setShowTooltip((s) => !s)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#374151",
              color: "#9ca3af",
              fontSize: 10,
              fontWeight: "bold",
            }}
          >
            ?
          </span>
          {showTooltip && (
            <span
              style={{
                position: "absolute",
                left: 0,
                top: "100%",
                marginTop: 4,
                zIndex: 50,
                width: 220,
                padding: "8px 10px",
                background: "#1f2937",
                border: "1px solid #374151",
                borderRadius: 6,
                fontSize: 11,
                color: "#e5e7eb",
                lineHeight: 1.4,
                boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
              }}
            >
              {help}
            </span>
          )}
        </span>
      )}
    </label>
  );
}

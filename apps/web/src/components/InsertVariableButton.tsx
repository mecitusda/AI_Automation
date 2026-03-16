import { useState, useRef, useEffect } from "react";
import type { VariableTreeNode } from "../utils/variableSystem";
import VariableTree from "./VariableTree";

type InsertVariableButtonProps = {
  tree: VariableTreeNode[];
  onInsert: (path: string) => void;
  label?: string;
};

export default function InsertVariableButton({ tree, onInsert, label = "Insert variable" }: InsertVariableButtonProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        const popover = document.querySelector(".insert-variable-popover");
        if (popover && !popover.contains(e.target as Node)) setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleSelect = (path: string) => {
    onInsert(path);
    setOpen(false);
  };

  return (
    <span style={{ position: "relative" }}>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          padding: "2px 8px",
          fontSize: 11,
          border: "1px solid #374151",
          borderRadius: 6,
          background: "#1f2937",
          color: "#93c5fd",
          cursor: "pointer",
        }}
      >
        {label}
      </button>
      {open && anchorRef.current && (
        <div
          className="insert-variable-popover"
          style={{
            position: "absolute",
            left: 0,
            top: "100%",
            marginTop: 4,
            zIndex: 100,
            width: 260,
            maxHeight: 220,
            overflow: "auto",
            background: "#111827",
            border: "1px solid #374151",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          <VariableTree tree={tree} onSelectPath={handleSelect} />
        </div>
      )}
    </span>
  );
}

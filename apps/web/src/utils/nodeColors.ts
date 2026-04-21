export const getNodeColors = (status: string) => {
  switch (status) {
    case "running":
      return {
        border: "#3b82f6",
        background: "#1e3a5f",
        glow: "0 0 12px #2563eb88",
        dot: "#60a5fa",
      };
    case "completed":
      return {
        border: "#22c55e",
        background: "#14532d",
        glow: "0 0 12px #16a34a88",
        dot: "#4ade80",
      };
    case "failed":
      return {
        border: "#ef4444",
        background: "#450a0a",
        glow: "0 0 12px #dc262688",
        dot: "#f87171",
      };
    case "retrying":
      return {
        border: "#fb923c",
        background: "#431407",
        glow: "0 0 14px #ea580c99",
        dot: "#fdba74",
      };
    case "pending":
      return {
        border: "#94a3b8",
        background: "#1e293b",
        glow: "none",
        dot: "#cbd5e1",
      };
    case "skipped":
      return {
        border: "#a855f7",
        background: "#3b0764",
        glow: "none",
        dot: "#c4b5fd",
      };
    case "partial":
      return {
        border: "#14b8a6",
        background: "#042f2e",
        glow: "0 0 12px #14b8a680",
        dot: "#5eead4",
      };
    case "cancelled":
      return {
        border: "#78716c",
        background: "#292524",
        glow: "none",
        dot: "#a8a29e",
      };
    default:
      return {
        border: "#374151",
        background: "#111827",
        glow: "none",
        dot: "#4b5563",
      };
  }
};
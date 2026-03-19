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
        border: "#f59e0b",
        background: "#451a03",
        glow: "0 0 12px #f59e0b88",
        dot: "#fbbf24",
      };
    case "pending":
      return {
        border: "#6b7280",
        background: "#1f2937",
        glow: "none",
        dot: "#9ca3af",
      };
    case "skipped":
      return {
        border: "#eab308",
        background: "#422006",
        glow: "none",
        dot: "#facc15",
      };
    case "partial":
      return {
        border: "#f59e0b",
        background: "#451a03",
        glow: "0 0 8px #f59e0b66",
        dot: "#fbbf24",
      };
    case "cancelled":
      return {
        border: "#374151",
        background: "#111827",
        glow: "none",
        dot: "#4b5563",
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
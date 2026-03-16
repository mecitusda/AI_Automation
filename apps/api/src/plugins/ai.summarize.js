export default {
  type: "ai.summarize",
  label: "AI Summarize",
  category: "ai",
  schema: [
    { key: "text", type: "string", label: "Text", placeholder: "Leave empty to use previous step output" },
    { key: "maxLength", type: "number", label: "Max length", default: 200 },
  ],
  output: {
    type: "object",
    properties: { summary: { type: "string" } },
  },
  executor: async ({ previousOutput, params, signal }) => {
    if (signal?.aborted) throw new Error("Cancelled");
    const text = params?.text ?? (previousOutput != null ? JSON.stringify(previousOutput) : "");
    const raw = text || (previousOutput != null ? JSON.stringify(previousOutput) : "Nothing to summarize");
    const summary = `Summary: ${String(raw).slice(0, 100)}...`;
    return { success: true, output: { summary } };
  },
};

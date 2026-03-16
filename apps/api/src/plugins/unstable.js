export default {
  type: "unstable",
  label: "Unstable (test)",
  category: "utilities",
  schema: [
    { key: "failRate", type: "number", label: "Fail rate (0-1)", default: 0.5 },
  ],
  output: { type: "object", properties: { ok: { type: "boolean" } } },
  executor: async ({ params }) => {
    const failRate = params?.failRate ?? 0.7;
    if (Math.random() < failRate) throw new Error("Random failure");
    return { success: true, output: { ok: true } };
  },
};

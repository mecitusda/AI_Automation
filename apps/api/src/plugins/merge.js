export default {
  type: "merge",
  label: "Merge",
  category: "control",
  schema: [
    {
      key: "strategy",
      type: "select",
      label: "Strategy",
      default: "object",
      options: [
        { value: "object", label: "Merge as object (key by source step id)" },
        { value: "array", label: "Array of outputs" },
      ],
    },
  ],
  output: {
    type: "object",
    properties: {
      merged: {},
      sources: {},
    },
  },
  handles: {
    inputs: [{ id: "default" }, { id: "in2" }],
    outputs: [{ id: "default" }],
  },
  executor: async ({ params, previousOutput }) => {
    const strategy = params?.strategy ?? "object";
    if (previousOutput != null && typeof previousOutput === "object" && !Array.isArray(previousOutput)) {
      const keys = Object.keys(previousOutput);
      if (strategy === "array") {
        const arr = keys.map((k) => previousOutput[k]);
        return { success: true, output: { merged: arr, sources: previousOutput } };
      }
      return { success: true, output: { merged: previousOutput, sources: previousOutput } };
    }
    return { success: true, output: { merged: previousOutput ?? {}, sources: {} } };
  },
};

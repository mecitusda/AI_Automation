export default {
  type: "parallel",
  label: "Parallel",
  category: "control",
  schema: [
    {
      key: "description",
      type: "string",
      label: "Description",
      placeholder: "Optional label (branching is defined by graph edges)",
    },
  ],
  output: {
    type: "object",
    properties: { output: { description: "Pass-through from previous step" } },
  },
  executor: async ({ previousOutput }) => {
    return {
      success: true,
      output: previousOutput ?? {},
    };
  },
};

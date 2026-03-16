export default {
  type: "setVariable",
  label: "Set Variable",
  category: "utilities",
  schema: [
    { key: "name", type: "string", label: "Variable name", required: true, placeholder: "myVar" },
    {
      key: "value",
      type: "string",
      label: "Value (supports {{ variables }})",
      placeholder: "{{ steps.fetch.output.data }}",
    },
  ],
  output: {
    type: "object",
    properties: { value: {} },
  },
  executor: async ({ params }) => {
    const name = params?.name ?? "value";
    const value = params?.value;
    return {
      success: true,
      output: { [name]: value },
    };
  },
  validate: (params) => {
    const err = {};
    if (!params?.name || String(params.name).trim() === "") err.name = "Name is required";
    return err;
  },
};

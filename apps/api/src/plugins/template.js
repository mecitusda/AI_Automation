export default {
  type: "template",
  label: "Template",
  category: "utilities",
  schema: [
    {
      key: "template",
      type: "string",
      label: "Template (use {{ path }} for variables)",
      required: true,
      placeholder: "Hello {{ trigger.name }}, result: {{ steps.fetch.output }}",
    },
    {
      key: "format",
      type: "select",
      label: "Output format",
      default: "text",
      options: [
        { value: "text", label: "Text" },
        { value: "json", label: "Parse as JSON" },
      ],
    },
  ],
  output: {
    type: "object",
    properties: { output: { type: "string" }, parsed: {} },
  },
  executor: async ({ params }) => {
    const template = params?.template ?? "";
    const format = params?.format ?? "text";
    const output = template;
    let parsed;
    if (format === "json") {
      try {
        parsed = JSON.parse(template);
      } catch {
        parsed = output;
      }
    } else {
      parsed = output;
    }
    return { success: true, output: { output, parsed } };
  },
};

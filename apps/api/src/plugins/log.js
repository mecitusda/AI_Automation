export default {
  type: "log",
  label: "Log",
  category: "utilities",
  schema: [
    { key: "message", type: "string", label: "Message", placeholder: "Message to log (supports {{ variables }})" },
  ],
  output: {
    type: "object",
    properties: { logged: { type: "boolean" } },
  },
  executor: async ({ params }) => {
    console.log("PLUGIN LOG:", params?.message);
    return { success: true, output: { logged: true }, meta: {} };
  },
  summaryTemplate: "{{ message }}",
};

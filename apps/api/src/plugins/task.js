export default {
  type: "task",
  label: "Task",
  category: "utilities",
  schema: [
    { key: "payload", type: "json", label: "Payload", placeholder: "{}" },
  ],
  output: { type: "object" },
  executor: async ({ params }) => {
    return { success: true, output: params?.payload ?? {} };
  },
};

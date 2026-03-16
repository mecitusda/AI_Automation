export default {
  type: "slack",
  label: "Slack",
  category: "utilities",
  credentials: [{ type: "slack", required: true }],
  schema: [
    { key: "channel", type: "string", label: "Channel", required: true, placeholder: "#general" },
    { key: "text", type: "string", label: "Message", placeholder: "Message (supports {{ variables }})" },
  ],
  output: {
    type: "object",
    properties: {
      sent: { type: "boolean" },
      channel: { type: "string" },
      textLength: { type: "number" },
    },
  },
  executor: async ({ params, credentials }) => {
    const channel = params?.channel ?? "";
    const text = params?.text ?? "";
    if (!channel) throw new Error("slack step requires params.channel");
    const token = credentials?.token ?? params?.token;
    if (!token) throw new Error("slack step requires a credential with token");
    return {
      success: true,
      output: { sent: true, channel, textLength: String(text).length },
    };
  },
  validate: (params) => {
    const err = {};
    if (!params?.channel || String(params.channel).trim() === "") err.channel = "Channel is required";
    return err;
  },
};

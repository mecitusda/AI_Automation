export default {
  type: "delay",
  label: "Delay",
  category: "control",
  schema: [
    { key: "ms", type: "number", label: "Delay (ms)", default: 1000, placeholder: "1000" },
  ],
  output: {
    type: "object",
    properties: { delayed: { type: "number" } },
  },
  executor: async ({ params, signal }) => {
    const ms = params?.ms ?? 1000;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error("Aborted"));
        });
      }
    });
    return { success: true, output: { delayed: ms }, meta: {} };
  },
};

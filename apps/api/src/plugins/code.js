import vm from "vm";

const DEFAULT_TIMEOUT_MS = 5000;
const CODE_PLUGIN_ENABLED = process.env.CODE_PLUGIN_ENABLED !== "false";

export default {
  type: "code",
  label: "Code",
  category: "utilities",
  schema: [
    {
      key: "code",
      type: "code",
      label: "JavaScript code",
      placeholder: "return { result: context.previousOutput };",
    },
    { key: "timeoutMs", type: "number", label: "Timeout (ms)", default: DEFAULT_TIMEOUT_MS },
  ],
  output: { type: "object" },
  executor: async ({ params, previousOutput }) => {
    if (!CODE_PLUGIN_ENABLED) {
      throw new Error("Code plugin is disabled by CODE_PLUGIN_ENABLED=false");
    }
    const codeStr = params?.code;
    const timeoutMs = Math.min(Number(params?.timeoutMs) || DEFAULT_TIMEOUT_MS, 30000);

    const sandbox = {
      context: { previousOutput, steps: {} },
      result: undefined,
    };

    const userCode = (codeStr || "return context.previousOutput;").trim();
    const wrapped = `
      "use strict";
      const context = sandbox.context;
      try {
        const fn = (function(context) { ${userCode} });
        sandbox.result = fn(context);
      } catch (e) {
        sandbox.result = { __error: e.message };
      }
    `;

    const script = new vm.Script(wrapped, { filename: "code-step.js" });
    const context = vm.createContext({ sandbox });
    const runOptions = { timeout: timeoutMs };
    try {
      script.runInContext(context, { ...runOptions, microtaskMode: 0 });
    } catch (e) {
      if (e.message && e.message.includes("microtaskMode")) {
        script.runInContext(context, runOptions);
      } else {
        throw e;
      }
    }

    const result = sandbox.result;
    if (result && typeof result === "object" && result.__error) {
      throw new Error(result.__error);
    }
    return { success: true, output: result ?? null };
  },
};

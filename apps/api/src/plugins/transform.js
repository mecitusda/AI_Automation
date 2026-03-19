export default {
  type: "transform",
  label: "Transform",
  category: "utilities",
  schema: [
    {
      key: "mappings",
      type: "json",
      label: "Mappings (array of { targetPath, sourcePath })",
      placeholder: '[{"targetPath": "title", "sourcePath": "steps.fetch.output.data.title"}]',
    },
    {
      key: "outputShape",
      type: "json",
      label: "Or output shape (object; values are source paths)",
      placeholder: '{"title": "steps.fetch.output.title", "count": "steps.count.output"}',
    },
  ],
  output: { type: "object" },
  executor: async ({ params, previousOutput }) => {
    const getAtPath = (obj, path) => {
      if (!path) return obj;
      const parts = String(path).split(".").filter(Boolean);
      let cur = obj;
      for (const p of parts) cur = cur?.[p];
      return cur;
    };

    const setAtPath = (obj, path, value) => {
      const parts = String(path).split(".").filter(Boolean);
      let ref = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (!(k in ref) || typeof ref[k] !== "object") ref[k] = {};
        ref = ref[k];
      }
      ref[parts[parts.length - 1]] = value;
    };

    const mappings = params?.mappings;
    const outputShape = params?.outputShape;

    if (outputShape && typeof outputShape === "object" && !Array.isArray(outputShape)) {
      const out = {};
      for (const [targetKey, sourcePath] of Object.entries(outputShape)) {
        const val = typeof sourcePath === "string" ? getAtPath(previousOutput, sourcePath) : sourcePath;
        out[targetKey] = val;
      }
      return { success: true, output: out, meta: {} };
    }

    if (Array.isArray(mappings)) {
      const out = {};
      for (const m of mappings) {
        const target = m?.targetPath;
        const source = m?.sourcePath;
        if (!target || source === undefined) continue;
        const val = getAtPath(previousOutput, source);
        setAtPath(out, target, val);
      }
      return { success: true, output: out, meta: {} };
    }

    return { success: true, output: {}, meta: {} };
  },
};

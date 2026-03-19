function deepMerge(target, source) {
  if (source == null || typeof source !== "object" || Array.isArray(source)) return source;
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] != null && typeof source[key] === "object" && !Array.isArray(source[key]) &&
        target[key] != null && typeof target[key] === "object" && !Array.isArray(target[key])) {
      out[key] = deepMerge(target[key], source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

export default {
  type: "merge",
  label: "Merge",
  category: "control",
  schema: [
    {
      key: "strategy",
      type: "select",
      label: "Strategy",
      default: "merge",
      options: [
        { value: "merge", label: "Merge (deep merge objects)" },
        { value: "append", label: "Append (concat arrays)" },
        { value: "override", label: "Override (later wins)" },
      ],
    },
    {
      key: "sources",
      type: "json",
      label: "Source paths (array of variable paths)",
      placeholder: '["steps.step_0.output", "steps.step_1.output"]',
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
    const strategy = params?.strategy ?? "merge";
    const sourcesParam = params?.sources;
    let values = [];
    if (Array.isArray(sourcesParam) && sourcesParam.length > 0) {
      values = sourcesParam;
    } else if (previousOutput != null && typeof previousOutput === "object" && !Array.isArray(previousOutput)) {
      values = Object.values(previousOutput);
    }

    if (strategy === "append") {
      const merged = values.reduce((acc, v) => (Array.isArray(v) ? acc.concat(v) : acc.concat([v])), []);
      return { success: true, output: { merged, sources: previousOutput ?? {} }, meta: {} };
    }
    if (strategy === "override") {
      const merged = values.length ? values[values.length - 1] : {};
      return { success: true, output: { merged, sources: previousOutput ?? {} }, meta: {} };
    }
    const merged = values.reduce((acc, v) => (v != null && typeof v === "object" && !Array.isArray(v) ? deepMerge(acc, v) : acc), {});
    return { success: true, output: { merged, sources: previousOutput ?? {} }, meta: {} };
  },
};

export function resolveVariables(obj, outputs) {
  if (typeof obj === "string") {
    return obj.replace(/\{\{(.*?)\}\}/g, (_, path) => {
      const parts = path.trim().split(".");
      const [stepId, , ...rest] = parts;

      const stepOutput = outputs.get(stepId);
      if (!stepOutput) return "";

      return rest.reduce((acc, key) => acc?.[key], stepOutput) ?? "";
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(item => resolveVariables(item, outputs));
  }

  if (typeof obj === "object" && obj !== null) {
    const newObj = {};
    for (const key in obj) {
      newObj[key] = resolveVariables(obj[key], outputs);
    }
    return newObj;
  }

  return obj;
}
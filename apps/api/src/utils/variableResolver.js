export function resolveVariables(obj, context) {

  const { steps, run, trigger, env, loop, error } = context;
  
  function resolvePath(path) {

    const parts = path.trim().split(".");
    const root = parts.shift();

    let source;
    

    if (root === "steps") {

      const stepId = parts.shift();

      let stepOutput;

      if (steps instanceof Map) {
        stepOutput = steps.get(stepId);
      } else {
        stepOutput = steps?.[stepId];
      }
    
      source = stepOutput;
    
    } else if (root === "run") {
      source = run;

    } else if (root === "trigger") {
      source = trigger;

    } else if (root === "error") {
      // Expose last error from orchestration to variables: {{ error.message }}, {{ error.stepId }}
      source = error ?? run?.lastError;

    } 
    else if (root === "env") {
      source = env;

    } else if (root === "loop") {
      source = loop;

    } else {
      return "";
    }
    return parts.reduce((acc, key) => {

  

  if (acc instanceof Map) {
    return acc.get(key);
  }

  return acc?.[key];

}, source);
  }

  /* ---------------- STRING ---------------- */

  if (typeof obj === "string") {

    const trimmed = obj.trim();

    const pureMatch = trimmed.match(/^\{\{(.*?)\}\}$/);

    if (pureMatch) {

      const result = resolvePath(pureMatch[1]);

      return result; // ARRAY / OBJECT olduğu gibi döner
    }

    return obj.replace(/\{\{(.*?)\}\}/g, (_, path) => {

      const val = resolvePath(path.trim());

      if (val === undefined || val === null) return "";

      return String(val);

    });
  }

  /* ---------------- ARRAY ---------------- */

  if (Array.isArray(obj)) {
    return obj.map(v => resolveVariables(v, context));
  }

  /* ---------------- OBJECT ---------------- */

  if (typeof obj === "object" && obj !== null) {

    const out = {};

    for (const key in obj) {
      out[key] = resolveVariables(obj[key], context);
    }

    return out;
  }

  return obj;
}
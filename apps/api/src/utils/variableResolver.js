export function resolveVariables(obj, context) {
  const debugRun = process.env.DEBUG_RUN === "true";

  const { steps, run, trigger, env, loop, loops, error } = context;
  
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

    } else if (root === "loops") {
      source = loops;

    } else {
      return "";
    }
    const resolved = parts.reduce((acc, key, idx) => {

  

  if (acc instanceof Map) {
    const mapped = acc.get(key);
    // Backward-compat: {{ trigger.<field> }} -> {{ trigger.body.<field> }}
    if (
      mapped === undefined &&
      root === "trigger" &&
      idx === 0
    ) {
      const body = acc.get("body");
      if (body instanceof Map) return body.get(key);
      return body?.[key];
    }
    return mapped;
  }

  const direct = acc?.[key];
  // Backward-compat: {{ trigger.<field> }} -> {{ trigger.body.<field> }}
  if (
    direct === undefined &&
    root === "trigger" &&
    idx === 0
  ) {
    return acc?.body?.[key];
  }

  return direct;

}, source);
    return resolved;
  }

  /* ---------------- STRING ---------------- */

  if (typeof obj === "string") {

    const trimmed = obj.trim();

    const pureMatch = trimmed.match(/^\{\{(.*?)\}\}$/);

    if (pureMatch) {

      const result = resolvePath(pureMatch[1]);
      if (debugRun) {
        console.log(JSON.stringify({
          level: "info",
          event: "variables.resolve.pure",
          timestamp: new Date().toISOString(),
          runId: run?._id?.toString?.() ?? undefined,
          expression: pureMatch[1]?.trim(),
          message: "Resolved pure variable expression"
        }));
      }

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
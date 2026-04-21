/**
 * Recursively redact sensitive fields before persisting or logging resolved step params.
 * @param {unknown} obj
 * @param {number} depth
 * @returns {unknown}
 */
export function redactExecutionParams(obj, depth = 0) {
  if (depth > 14) return "[MaxDepth]";
  if (obj == null) return obj;
  if (typeof obj === "string") {
    if (obj.length > 8000) return `${obj.slice(0, 8000)}…`;
    return obj;
  }
  if (typeof obj === "number" || typeof obj === "boolean") return obj;
  if (Array.isArray(obj)) return obj.map((item) => redactExecutionParams(item, depth + 1));
  if (typeof obj !== "object") return obj;

  const sensitiveKey = (k) => {
    const low = k.toLowerCase();
    if (
      low === "password" ||
      low === "secret" ||
      low === "authorization" ||
      low === "apikey" ||
      low === "api_key" ||
      low === "token" ||
      low === "credentialid" ||
      low === "refreshtoken" ||
      low.endsWith("_secret") ||
      low.endsWith("_password") ||
      low.endsWith("_token") ||
      (low.includes("secret") && low.length < 40)
    ) {
      return true;
    }
    return false;
  };

  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (sensitiveKey(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactExecutionParams(v, depth + 1);
    }
  }
  return out;
}

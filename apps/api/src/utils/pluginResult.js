/**
 * Canonical plugin result shape for production-grade workflow engine.
 * @typedef {Object} PluginMeta
 * @property {number} [durationMs]
 * @property {{ prompt?: number; completion?: number; total?: number }} [tokens]
 * @property {string|number} [status]
 * @property {number} [attempt]
 *
 * @typedef {Object} PluginResult
 * @property {boolean} success
 * @property {*} output
 * @property {PluginMeta} [meta]
 */

/**
 * Normalize plugin executor return value to canonical shape.
 * Ensures backward compatibility with plugins that return { success, output } or raw values.
 *
 * @param {*} raw - Return value from plugin.executor()
 * @returns {PluginResult}
 */
export function normalizePluginResult(raw) {
  if (raw == null) {
    return { success: false, output: null, meta: { status: "error" } };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { success: true, output: raw, meta: {} };
  }
  const hasSuccess = "success" in raw && typeof raw.success === "boolean";
  const hasOutput = "output" in raw;
  if (hasSuccess && hasOutput) {
    const meta = raw.meta != null && typeof raw.meta === "object" ? { ...raw.meta } : {};
    return { success: raw.success, output: raw.output, meta };
  }
  return { success: true, output: raw, meta: {} };
}

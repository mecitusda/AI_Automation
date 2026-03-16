import { plugins } from "./index.js";

/**
 * Get a plugin by its type.
 * @param {string} type - Plugin type (e.g. "http", "openai")
 * @returns {object|undefined} Plugin definition or undefined
 */
export function getPlugin(type) {
  return plugins[type];
}

/**
 * Get all registered plugins (deduplicated by type; aliases like "ai" excluded from list).
 * @returns {object[]} Array of plugin objects
 */
export function getAllPlugins() {
  const seen = new Set();
  const list = [];
  for (const [key, plugin] of Object.entries(plugins)) {
    if (!plugin || seen.has(plugin.type)) continue;
    seen.add(plugin.type);
    list.push(plugin);
  }
  return list;
}

/**
 * Get the schema (form fields) for a plugin.
 * @param {string} type - Plugin type
 * @returns {array|undefined} Schema array or undefined
 */
export function getPluginSchema(type) {
  const plugin = getPlugin(type);
  return plugin?.schema;
}

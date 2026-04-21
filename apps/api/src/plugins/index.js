import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @deprecated Use getPluginRegistry() / getPlugin(type) instead. Kept for backward compatibility. */
export const plugins = {};

function assertPluginContract(file, plugin) {
  if (!plugin || typeof plugin !== "object") {
    throw new Error(`Plugin in ${file} must export an object`);
  }
  if (!plugin.type || typeof plugin.type !== "string") {
    throw new Error(`Plugin in ${file} must export string "type"`);
  }
  if (!plugin.label || typeof plugin.label !== "string") {
    throw new Error(`Plugin "${plugin.type}" in ${file} must export string "label"`);
  }
  if (plugin.schema != null && !Array.isArray(plugin.schema)) {
    throw new Error(`Plugin "${plugin.type}" in ${file} has invalid "schema" (array expected)`);
  }
  const executor = plugin.executor ?? plugin.execute;
  const requiresExecutor = plugin.trigger !== true;
  if (requiresExecutor && typeof executor !== "function") {
    throw new Error(`Plugin "${plugin.type}" in ${file} must export "executor" function`);
  }
  if (plugin.validate != null && typeof plugin.validate !== "function") {
    throw new Error(`Plugin "${plugin.type}" in ${file} has invalid "validate" (function expected)`);
  }
}

const files = fs.readdirSync(__dirname);

for (const file of files) {
  if (file === "index.js" || file === "registry.js" || !file.endsWith(".js")) continue;

  const module = await import(`./${file}`);
  const plugin = module.default ?? Object.values(module)[0];
  assertPluginContract(file, plugin);

  plugins[plugin.type] = plugin;
}

// Backward compatibility: workflows with step type "ai" run the openai plugin
if (plugins.openai) plugins.ai = plugins.openai;

console.log("Loaded plugins:", Object.keys(plugins));

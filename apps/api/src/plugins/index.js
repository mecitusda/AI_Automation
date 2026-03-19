import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @deprecated Use getPluginRegistry() / getPlugin(type) instead. Kept for backward compatibility. */
export const plugins = {};

const files = fs.readdirSync(__dirname);

for (const file of files) {
  if (file === "index.js" || file === "registry.js" || !file.endsWith(".js")) continue;

  const module = await import(`./${file}`);
  const plugin = module.default ?? Object.values(module)[0];

  if (!plugin?.type) {
    throw new Error(`Plugin in ${file} must export { type }`);
  }

  plugins[plugin.type] = plugin;
}

// Backward compatibility: workflows with step type "ai" run the openai plugin
if (plugins.openai) plugins.ai = plugins.openai;

console.log("Loaded plugins:", Object.keys(plugins));

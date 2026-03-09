import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const plugins = {};

const files = fs.readdirSync(__dirname);

for (const file of files) {

  if (file === "index.js" || !file.endsWith(".js")) continue;

  const module = await import(`./${file}`);

  const plugin = module.default ?? Object.values(module)[0];

  if (!plugin?.name) {
    throw new Error(`Plugin in ${file} must export { name }`);
  }

  plugins[plugin.name] = plugin;
}

console.log("Loaded plugins:", Object.keys(plugins));
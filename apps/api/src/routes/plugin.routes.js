import express from "express";
import { getAllPlugins, getPlugin } from "../plugins/registry.js";

const router = express.Router();

function toPluginMeta(plugin) {
  return {
    type: plugin.type,
    label: plugin.label ?? plugin.type,
    category: plugin.category ?? "utilities",
    schema: plugin.schema ?? [],
    output: plugin.output ?? null,
    credentials: plugin.credentials ?? [],
    handles: plugin.handles ?? {
      inputs: [{ id: "default" }],
      outputs: [{ id: "default" }],
    },
    summaryTemplate: plugin.summaryTemplate ?? null,
    trigger: plugin.trigger === true,
  };
}

router.get("/", (_req, res) => {
  try {
    const list = getAllPlugins().map(toPluginMeta);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to list plugins" });
  }
});

router.get("/:type", (req, res) => {
  try {
    const plugin = getPlugin(req.params.type);
    if (!plugin) return res.status(404).json({ error: "Plugin not found" });
    res.json(toPluginMeta(plugin));
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to get plugin" });
  }
});

export default router;

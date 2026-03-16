import express from "express";
import { Template } from "../models/template.model.js";
import { Workflow } from "../models/workflow.model.js";
import { validateWorkflowPayload } from "../utils/validateWorkflow.js";
import { registerCronWorkflow } from "../config/scheduler.js";
import { channel } from "../config/rabbit.js";

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const list = await Template.find().select("name description category createdAt").lean();
    return res.json(
      list.map((d) => ({
        id: d._id.toString(),
        name: d.name,
        description: d.description || "",
        category: d.category || "General",
        createdAt: d.createdAt
      }))
    );
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to list templates" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const doc = await Template.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: "Template not found" });
    return res.json({
      id: doc._id.toString(),
      name: doc.name,
      description: doc.description || "",
      category: doc.category || "General",
      workflow: doc.workflow,
      createdAt: doc.createdAt
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to get template" });
  }
});

router.post("/install/:id", async (req, res) => {
  try {
    const template = await Template.findById(req.params.id).lean();
    if (!template) return res.status(404).json({ error: "Template not found" });
    const workflowPayload = template.workflow;
    if (!workflowPayload || typeof workflowPayload !== "object") {
      return res.status(400).json({ error: "Template has no valid workflow" });
    }
    const nameOverride = req.body?.name;
    const payloadToValidate = {
      ...workflowPayload,
      ...(nameOverride != null && nameOverride !== "" ? { name: String(nameOverride) } : {})
    };
    const validated = validateWorkflowPayload(payloadToValidate);
    const workflow = await Workflow.create({
      name: validated.name,
      steps: validated.steps,
      maxParallel: validated.maxParallel,
      trigger: validated.trigger,
      enabled: validated.enabled,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          steps: validated.steps,
          maxParallel: validated.maxParallel,
          createdAt: new Date()
        }
      ]
    });
    if (workflow.enabled && workflow.trigger?.type === "cron") {
      registerCronWorkflow(workflow);
    }
    await channel.publish(
      "automation.direct",
      "workflow.created",
      Buffer.from(JSON.stringify({ workflowId: workflow._id.toString() }))
    );
    return res.status(201).json({
      id: workflow._id.toString(),
      name: workflow.name,
      message: "Workflow installed"
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Install failed" });
  }
});

export default router;

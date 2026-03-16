import express from "express";
import { Workflow } from "../models/workflow.model.js";
import { Run } from "../models/run.model.js";
import { channel } from "../config/rabbit.js";

const router = express.Router();

/**
 * POST /trigger/:workflowId
 * Webhook trigger: start a run with request body as triggerPayload.
 * - Rejects disabled workflows (403)
 * - Optional secret: X-Webhook-Secret header or query ?secret=; 401 if workflow has webhookSecret and it does not match
 */
router.post("/:workflowId", async (req, res) => {
  try {
    const { workflowId } = req.params;

    const workflow = await Workflow.findById(workflowId);
    if (!workflow) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    if (workflow.enabled === false) {
      return res.status(403).json({ error: "Workflow is disabled" });
    }

    const secret = workflow.trigger?.webhookSecret;
    if (secret) {
      const provided =
        req.headers["x-webhook-secret"] ||
        req.query.secret;
      if (provided !== secret) {
        return res.status(401).json({ error: "Webhook secret mismatch" });
      }
    }

    const triggerPayload =
      req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)
        ? { ...req.body }
        : {};

    const run = await Run.create({
      workflowId: workflow._id,
      workflowVersion: workflow.currentVersion ?? 1,
      status: "queued",
      triggerPayload
    });

    await channel.publish(
      "automation.direct",
      "run.start",
      Buffer.from(JSON.stringify({ runId: run._id.toString() }))
    );

    res.status(202).json({
      runId: run._id.toString(),
      message: "Run queued"
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

export default router;

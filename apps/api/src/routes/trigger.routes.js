import express from "express";
import { Workflow } from "../models/workflow.model.js";
import { Run } from "../models/run.model.js";
import { channel } from "../config/rabbit.js";
import { checkWebhookRateLimit } from "../utils/webhookRateLimiter.js";

const router = express.Router();

/**
 * Build triggerPayload for webhook: { body, query, ...body } so that
 * {{ trigger.body }}, {{ trigger.query }}, and {{ trigger.email }} etc. all work.
 */
function buildTriggerPayload(body, query) {
  const bodyObj =
    body && typeof body === "object" && !Buffer.isBuffer(body)
      ? { ...body }
      : {};
  const queryObj = query && typeof query === "object" ? { ...query } : {};
  return { body: bodyObj, query: queryObj, ...bodyObj };
}

/**
 * Shared webhook handler: load workflow, validate, create run, publish.
 * Used by both GET and POST.
 */
async function handleWebhook(req, res, bodyOverride = undefined) {
  const { workflowId } = req.params;

  // Webhook-only limiter: apply only when this router is mounted under `/webhook`.
  if (req.baseUrl === "/webhook") {
    const allowed = await checkWebhookRateLimit(workflowId, 10);
    if (!allowed) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
  }

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
  const body = bodyOverride !== undefined ? bodyOverride : req.body;
  const triggerPayload = buildTriggerPayload(body, req.query);
  const run = await Run.create({
    workflowId: workflow._id,
    workflowVersion: workflow.currentVersion ?? 1,
    status: "queued",
    triggerPayload,
  });
  await channel.publish(
    "automation.direct",
    "run.start",
    Buffer.from(JSON.stringify({ runId: run._id.toString() }))
  );
  return res.status(202).json({
    runId: run._id.toString(),
    message: "Run queued",
  });
}

/**
 * GET /:workflowId (or /webhook/:workflowId)
 * Trigger with query string only; body is {}.
 */
router.get("/:workflowId", async (req, res) => {
  try {
    await handleWebhook(req, res, {});
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * POST /:workflowId (or /webhook/:workflowId)
 * Trigger with JSON body; triggerPayload = { body, query, ...body }.
 */
router.post("/:workflowId", async (req, res) => {
  try {
    await handleWebhook(req, res);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

export default router;

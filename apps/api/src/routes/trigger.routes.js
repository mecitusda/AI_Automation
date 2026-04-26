import express from "express";
import { channel } from "../config/rabbit.js";
import { checkWebhookRateLimit } from "../utils/webhookRateLimiter.js";
import { checkWebhookIpThrottle, verifyWebhookSignature } from "../utils/webhookSecurity.js";
import { decrypt } from "../utils/credentialCrypto.js";
import { createTelegramEvent, findTelegramEventByUpdate } from "../utils/telegram/telegramEventStore.js";
import { logInfo, logWarn } from "../utils/logger.js";
import { incrMetric } from "../utils/metricsCounter.js";
import { getPlatformModels } from "../utils/tenantModels.js";

const router = express.Router();
const modelsOf = () => getPlatformModels();

/**
 * Build triggerPayload for webhook in canonical shape:
 * { body, query, payload }.
 *
 * We intentionally avoid spreading body fields at root level to prevent
 * duplicated keys and ambiguous variable paths. Use:
 * - {{ trigger.body.<field> }}
 * - {{ trigger.query.<field> }}
 * - {{ trigger.payload }} (full body alias)
 */
function buildTriggerPayload(body, query) {
  const bodyObj =
    body && typeof body === "object" && !Buffer.isBuffer(body)
      ? { ...body }
      : {};
  const queryObj = query && typeof query === "object" ? { ...query } : {};
  return { body: bodyObj, query: queryObj, payload: bodyObj };
}

/**
 * Shared webhook handler: load workflow, validate, create run, publish.
 * Used by both GET and POST.
 */
async function handleWebhook(req, res, bodyOverride = undefined) {
  const { Workflow, Run } = modelsOf(req);
  const { workflowId } = req.params;
  const clientIp = String(
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    ""
  );

  // Apply webhook protections regardless of mount path.
  const allowed = await checkWebhookRateLimit(workflowId, 10);
  if (!allowed) {
    return res.status(429).json({ error: "Rate limit exceeded" });
  }
  const ipAllowed = await checkWebhookIpThrottle({ workflowId, ip: clientIp });
  if (!ipAllowed) {
    return res.status(429).json({ error: "IP rate limit exceeded" });
  }

  const workflow = await Workflow.findById(workflowId);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }
  if (workflow.enabled === false) {
    return res.status(403).json({ error: "Workflow is disabled" });
  }
  if (workflow.trigger?.type !== "trigger.webhook") {
    return res.status(400).json({ error: "Workflow trigger type is not webhook" });
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
  const signatureEnabled = workflow.trigger?.signatureRequired === true;
  if (signatureEnabled) {
    const rawBody = bodyOverride !== undefined ? bodyOverride : req.body;
    const signature = req.headers["x-signature"]?.toString();
    const hmacSecret = workflow.trigger?.signatureSecret || workflow.trigger?.webhookSecret;
    const valid = verifyWebhookSignature({
      secret: hmacSecret,
      rawBody,
      signatureHeader: signature
    });
    if (!valid) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }
  }
  const body = bodyOverride !== undefined ? bodyOverride : req.body;
  const triggerPayload = buildTriggerPayload(body, req.query);
  const run = await Run.create({
    userId: workflow.userId,
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

function detectTelegramUpdateType(update) {
  const keys = [
    "message",
    "edited_message",
    "channel_post",
    "callback_query",
    "inline_query",
    "poll",
    "pre_checkout_query",
    "shipping_query",
  ];
  return keys.find((k) => update && update[k]) || "unknown";
}

function normalizeTelegramTriggerPayload(update) {
  const updateType = detectTelegramUpdateType(update);
  const root = update?.[updateType] || {};
  const chatId = root?.chat?.id ?? root?.message?.chat?.id ?? null;
  const fromId = root?.from?.id ?? root?.message?.from?.id ?? null;
  const messageId = root?.message_id ?? root?.message?.message_id ?? null;
  return {
    telegram: update,
    updateId: Number(update?.update_id ?? -1),
    updateType,
    chatId: chatId != null ? String(chatId) : null,
    fromId: fromId != null ? String(fromId) : null,
    messageId: messageId != null ? String(messageId) : null,
  };
}

async function loadTelegramBotCredential(workflow) {
  const { Credential } = getPlatformModels();
  const credentialId = workflow.trigger?.credentialId;
  if (!credentialId) return null;
  const cred = await Credential.findOne({ _id: credentialId, userId: workflow.userId }).lean();
  if (!cred) return null;
  let data;
  try {
    data = decrypt(cred.data);
  } catch {
    return null;
  }
  return { credentialId: cred._id, data };
}

async function handleTelegramTrigger(req, res) {
  const { Workflow, Run } = modelsOf(req);
  const { workflowId } = req.params;
  const update = req.body && typeof req.body === "object" ? req.body : {};
  const updateId = Number(update?.update_id ?? -1);

  const workflow = await Workflow.findById(workflowId);
  if (!workflow) return res.status(404).json({ error: "Workflow not found" });
  if (workflow.enabled === false) return res.status(403).json({ error: "Workflow is disabled" });
  if (workflow.trigger?.type !== "trigger.telegram") {
    return res.status(400).json({ error: "Workflow trigger type is not telegram" });
  }

  const secret = workflow.trigger?.webhookSecret;
  if (secret) {
    const provided = req.headers["x-telegram-bot-api-secret-token"]?.toString() || req.headers["x-webhook-secret"]?.toString();
    if (provided !== secret) {
      await incrMetric("telegram.trigger.secret_mismatch", 1);
      return res.status(401).json({ error: "Telegram webhook secret mismatch" });
    }
  }

  const updateType = detectTelegramUpdateType(update);
  const allowedUpdates = Array.isArray(workflow.trigger?.allowedUpdates) ? workflow.trigger.allowedUpdates : [];
  if (allowedUpdates.length > 0 && !allowedUpdates.includes(updateType)) {
    await incrMetric("telegram.trigger.filtered", 1);
    return res.status(200).json({ ok: true, skipped: true, reason: "update type not allowed" });
  }

  const credential = await loadTelegramBotCredential(workflow);
  const botId = credential?.data?.botUsername || credential?.data?.botId || String(workflow.trigger?.credentialId || "");
  const duplicate = await findTelegramEventByUpdate(
    "bot_api",
    botId,
    updateId
  );
  if (duplicate) {
    await incrMetric("telegram.trigger.dedupe", 1);
    return res.status(200).json({ ok: true, deduped: true });
  }

  const triggerPayload = normalizeTelegramTriggerPayload(update);
  const run = await Run.create({
    userId: workflow.userId,
    workflowId: workflow._id,
    workflowVersion: workflow.currentVersion ?? 1,
    status: "queued",
    triggerPayload
  });

  await createTelegramEvent({
    userId: workflow.userId,
    runId: run._id,
    workflowId: workflow._id,
    stepId: "telegram.trigger",
    iteration: 0,
    providerMode: "bot_api",
    operation: "trigger.received",
    direction: "inbound",
    status: "delivered",
    credentialId: workflow.trigger?.credentialId || null,
    telegram: {
      botId,
      updateId,
      chatId: triggerPayload.chatId,
      fromId: triggerPayload.fromId,
      messageId: triggerPayload.messageId
    },
    payloadRaw: update,
    payloadNormalized: triggerPayload,
    sentAt: new Date()
  });

  await channel.publish(
    "automation.direct",
    "run.start",
    Buffer.from(JSON.stringify({ runId: run._id.toString() }))
  );
  await incrMetric("telegram.trigger.received", 1);
  logInfo("telegram.trigger.received", { workflowId: workflow._id.toString(), runId: run._id.toString(), updateType });

  return res.status(202).json({ runId: run._id.toString(), message: "Run queued from telegram trigger" });
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
 * Trigger with JSON body.
 */
router.post("/telegram/:workflowId", async (req, res) => {
  try {
    await handleTelegramTrigger(req, res);
  } catch (err) {
    logWarn("telegram.trigger.error", { message: err?.message || String(err), workflowId: req.params.workflowId });
    await incrMetric("telegram.trigger.error", 1);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

router.post("/:workflowId", async (req, res) => {
  try {
    await handleWebhook(req, res);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

export default router;

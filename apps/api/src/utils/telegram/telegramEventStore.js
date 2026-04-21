import crypto from "crypto";
import { TelegramEvent } from "../../models/telegramEvent.model.js";
import { redactExecutionParams } from "../redactExecutionParams.js";
import { logError } from "../logger.js";

export function createOutboundDedupeKey({ executionId, operation, chatId, requestHash }) {
  return [executionId || "", operation || "", chatId || "", requestHash || ""].join(":");
}

export function sha256Json(value) {
  const json = JSON.stringify(value ?? {});
  return crypto.createHash("sha256").update(json).digest("hex");
}

export async function createTelegramEvent(data) {
  try {
    const payloadRaw = redactExecutionParams(data?.payloadRaw ?? null);
    const payloadNormalized = redactExecutionParams(data?.payloadNormalized ?? null);
    const doc = await TelegramEvent.create({
      ...data,
      payloadRaw,
      payloadNormalized
    });
    return doc;
  } catch (err) {
    logError("telegram.event.create.error", {
      message: err?.message || String(err),
      runId: data?.runId,
      stepId: data?.stepId
    });
    return null;
  }
}

export async function findTelegramEventByUpdate(providerMode, botId, updateId) {
  if (!updateId && updateId !== 0) return null;
  return TelegramEvent.findOne({
    providerMode,
    "telegram.botId": botId,
    "telegram.updateId": Number(updateId)
  }).lean();
}

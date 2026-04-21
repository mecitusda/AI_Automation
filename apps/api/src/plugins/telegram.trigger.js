import { TELEGRAM_CAPABILITY_MATRIX } from "../utils/telegramCapabilities.js";

export default {
  type: "telegram.trigger",
  label: "Telegram Trigger",
  category: "trigger",
  trigger: true,
  schema: [
    { key: "mode", type: "select", label: "Trigger Mode", default: "webhook", options: [{ value: "webhook", label: "Webhook" }, { value: "polling", label: "Polling (fallback)" }] },
    { key: "credentialId", type: "credential", label: "Bot Credential", required: true },
    { key: "allowedUpdates", type: "multiselect", label: "Allowed Updates", options: TELEGRAM_CAPABILITY_MATRIX.p0_bot_api.triggerUpdates.map((u) => ({ value: u, label: u })) },
    { key: "webhookSecret", type: "string", label: "Webhook Secret" }
  ],
  output: {
    type: "object",
    properties: {
      updateId: { type: "number" },
      updateType: { type: "string" },
      chatId: { type: "string" },
      fromId: { type: "string" },
      payload: {}
    }
  },
  summaryTemplate: "telegram trigger ({{ mode }})"
};

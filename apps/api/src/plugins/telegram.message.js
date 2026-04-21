import { callTelegramBotApi } from "../providers/telegram/botApiClient.js";
import { callTelegramMtproto } from "../providers/telegram/mtprotoClient.js";
import { createTelegramEvent, createOutboundDedupeKey, sha256Json } from "../utils/telegram/telegramEventStore.js";
import { incrMetric } from "../utils/metricsCounter.js";

const OP_TO_METHOD = {
  sendMessage: "sendMessage",
  editMessageText: "editMessageText",
  deleteMessage: "deleteMessage",
  pinChatMessage: "pinChatMessage",
  unpinChatMessage: "unpinChatMessage",
  sendPhoto: "sendPhoto",
  sendDocument: "sendDocument",
  sendMediaGroup: "sendMediaGroup",
  answerCallbackQuery: "answerCallbackQuery"
};

function toStringOrUndefined(v) {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function buildPayload(operation, params) {
  const chatId = toStringOrUndefined(params.chatId);
  const messageThreadId = params.messageThreadId != null ? Number(params.messageThreadId) : undefined;
  const parseMode = toStringOrUndefined(params.parseMode);
  const disableNotification = params.disableNotification === true;

  switch (operation) {
    case "sendMessage":
      return {
        chat_id: chatId,
        text: String(params.text ?? ""),
        parse_mode: parseMode,
        disable_notification: disableNotification,
        message_thread_id: Number.isFinite(messageThreadId) ? messageThreadId : undefined,
        reply_markup: params.replyMarkup
      };
    case "editMessageText":
      return {
        chat_id: chatId,
        message_id: Number(params.messageId),
        text: String(params.text ?? ""),
        parse_mode: parseMode,
        reply_markup: params.replyMarkup
      };
    case "deleteMessage":
      return {
        chat_id: chatId,
        message_id: Number(params.messageId)
      };
    case "pinChatMessage":
      return {
        chat_id: chatId,
        message_id: Number(params.messageId),
        disable_notification: disableNotification
      };
    case "unpinChatMessage":
      return {
        chat_id: chatId,
        message_id: params.messageId != null ? Number(params.messageId) : undefined
      };
    case "sendPhoto":
      return {
        chat_id: chatId,
        photo: String(params.photo ?? ""),
        caption: params.caption != null ? String(params.caption) : undefined,
        parse_mode: parseMode,
        disable_notification: disableNotification,
        message_thread_id: Number.isFinite(messageThreadId) ? messageThreadId : undefined
      };
    case "sendDocument":
      return {
        chat_id: chatId,
        document: String(params.document ?? ""),
        caption: params.caption != null ? String(params.caption) : undefined,
        parse_mode: parseMode,
        disable_notification: disableNotification,
        message_thread_id: Number.isFinite(messageThreadId) ? messageThreadId : undefined
      };
    case "sendMediaGroup": {
      const media = Array.isArray(params.media)
        ? params.media
        : (typeof params.media === "string" ? JSON.parse(params.media) : []);
      return {
        chat_id: chatId,
        media,
        disable_notification: disableNotification,
        message_thread_id: Number.isFinite(messageThreadId) ? messageThreadId : undefined
      };
    }
    case "answerCallbackQuery":
      return {
        callback_query_id: String(params.callbackQueryId ?? ""),
        text: params.text != null ? String(params.text) : undefined,
        show_alert: params.showAlert === true,
        url: toStringOrUndefined(params.url),
        cache_time: params.cacheTime != null ? Number(params.cacheTime) : undefined
      };
    default:
      throw new Error(`Unsupported telegram operation: ${operation}`);
  }
}

export default {
  type: "telegram.message",
  label: "Telegram Message",
  category: "utilities",
  credentials: [{ type: "telegram.bot", required: true }],
  schema: [
    {
      key: "operation",
      type: "select",
      label: "Operation",
      default: "sendMessage",
      options: Object.keys(OP_TO_METHOD).map((op) => ({ value: op, label: op }))
    },
    { key: "providerMode", type: "select", label: "Provider", default: "bot_api", options: [{ value: "bot_api", label: "Bot API" }, { value: "mtproto", label: "User Account (MTProto)" }] },
    { key: "credentialId", type: "credential", label: "Credential", required: true },
    { key: "chatId", type: "string", label: "Chat ID" },
    { key: "messageId", type: "string", label: "Message ID" },
    { key: "callbackQueryId", type: "string", label: "Callback Query ID" },
    { key: "text", type: "string", label: "Text" },
    { key: "photo", type: "string", label: "Photo URL or file_id" },
    { key: "document", type: "string", label: "Document URL or file_id" },
    { key: "caption", type: "string", label: "Caption" },
    { key: "media", type: "json", label: "Media Group" },
    { key: "replyMarkup", type: "json", label: "Reply Markup" },
    { key: "parseMode", type: "select", label: "Parse Mode", default: "", options: [{ value: "", label: "None" }, { value: "MarkdownV2", label: "MarkdownV2" }, { value: "Markdown", label: "Markdown" }, { value: "HTML", label: "HTML" }] },
    { key: "messageThreadId", type: "string", label: "Topic Thread ID" },
    { key: "disableNotification", type: "boolean", label: "Disable Notification", default: false },
    { key: "showAlert", type: "boolean", label: "Callback Alert", default: false },
    { key: "url", type: "string", label: "Callback URL" },
    { key: "cacheTime", type: "number", label: "Callback Cache Time", default: 0 }
  ],
  output: {
    type: "object",
    properties: {
      operation: { type: "string" },
      messageId: { type: "string" },
      chatId: { type: "string" },
      raw: {}
    }
  },
  validate: (params) => {
    const e = {};
    const op = params?.operation;
    if (!op || !OP_TO_METHOD[op]) e.operation = "Valid operation is required";
    if (!params?.providerMode) e.providerMode = "providerMode is required";
    if (params?.providerMode === "bot_api") {
      const hasChat = ["sendMessage", "editMessageText", "deleteMessage", "pinChatMessage", "unpinChatMessage", "sendPhoto", "sendDocument", "sendMediaGroup"].includes(op);
      if (hasChat && !toStringOrUndefined(params?.chatId)) e.chatId = "chatId is required";
      if (op === "sendMessage" && !toStringOrUndefined(params?.text)) e.text = "text is required";
      if (op === "editMessageText") {
        if (!toStringOrUndefined(params?.messageId)) e.messageId = "messageId is required";
        if (!toStringOrUndefined(params?.text)) e.text = "text is required";
      }
    }
    return e;
  },
  executor: async ({ params, credentials, signal, context }) => {
    const operation = params?.operation || "sendMessage";
    const providerMode = params?.providerMode || "bot_api";
    const botToken = credentials?.botToken || params?.botToken;
    const payload = buildPayload(operation, params || {});
    const requestHash = sha256Json({ providerMode, operation, payload });
    const dedupeKey = createOutboundDedupeKey({
      executionId: context?.executionId,
      operation,
      chatId: payload.chat_id,
      requestHash
    });

    await createTelegramEvent({
      userId: context?.userId,
      runId: context?.runId,
      workflowId: context?.workflowId,
      stepId: context?.stepId,
      iteration: context?.iteration ?? 0,
      executionId: context?.executionId,
      credentialId: params?.credentialId,
      direction: "outbound",
      providerMode,
      operation,
      status: "queued",
      telegram: {
        chatId: payload.chat_id != null ? String(payload.chat_id) : undefined,
        threadId: payload.message_thread_id != null ? String(payload.message_thread_id) : undefined
      },
      payloadRaw: payload,
      payloadNormalized: { operation, providerMode },
      requestHash,
      dedupeKey
    });

    let result;
    if (providerMode === "mtproto") {
      result = await callTelegramMtproto({ operation, payload, signal, credentials, context });
    } else {
      if (!botToken) throw new Error("telegram.bot credential with botToken is required");
      const method = OP_TO_METHOD[operation];
      result = await callTelegramBotApi({ botToken, method, payload, signal });
    }

    const messageId = result?.output?.message_id ?? result?.output?.messageId;
    const chatId = result?.output?.chat?.id ?? payload.chat_id;

    await createTelegramEvent({
      userId: context?.userId,
      runId: context?.runId,
      workflowId: context?.workflowId,
      stepId: context?.stepId,
      iteration: context?.iteration ?? 0,
      executionId: context?.executionId,
      credentialId: params?.credentialId,
      direction: "outbound",
      providerMode,
      operation,
      status: result.success ? "sent" : "failed",
      telegram: {
        chatId: chatId != null ? String(chatId) : undefined,
        messageId: messageId != null ? String(messageId) : undefined,
        threadId: payload.message_thread_id != null ? String(payload.message_thread_id) : undefined
      },
      payloadRaw: payload,
      payloadNormalized: result?.output ?? null,
      error: result.success ? undefined : result?.meta?.errorMessage,
      requestHash,
      dedupeKey,
      sentAt: new Date()
    });

    await incrMetric(result.success ? "telegram.send.success" : "telegram.send.failed", 1);

    return {
      success: result.success,
      output: {
        operation,
        messageId: messageId != null ? String(messageId) : undefined,
        chatId: chatId != null ? String(chatId) : undefined,
        raw: result?.output ?? null
      },
      meta: {
        providerMode,
        errorMessage: result?.meta?.errorMessage,
        status: result?.meta?.status,
        dedupeKey
      }
    };
  },
  summaryTemplate: "telegram {{ operation }} -> {{ chatId }}"
};

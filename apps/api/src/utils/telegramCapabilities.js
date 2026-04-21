export const TELEGRAM_CAPABILITY_MATRIX = {
  p0_bot_api: {
    triggerModes: ["webhook", "polling_fallback"],
    triggerUpdates: [
      "message",
      "edited_message",
      "channel_post",
      "callback_query",
      "inline_query",
      "poll",
      "pre_checkout_query",
      "shipping_query"
    ],
    operations: [
      "sendMessage",
      "editMessageText",
      "deleteMessage",
      "pinChatMessage",
      "unpinChatMessage",
      "sendPhoto",
      "sendDocument",
      "sendMediaGroup",
      "answerCallbackQuery"
    ]
  },
  p1_mtproto: {
    operations: [
      "listDialogs",
      "fetchHistory",
      "advancedSearch",
      "forwardMessages"
    ],
    requiresSession: true
  }
};

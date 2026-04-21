import mongoose from "mongoose";

const telegramEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  runId: { type: mongoose.Schema.Types.ObjectId, ref: "Run", index: true, default: null },
  workflowId: { type: mongoose.Schema.Types.ObjectId, ref: "Workflow", index: true, default: null },
  stepId: { type: String, index: true },
  iteration: { type: Number, default: 0 },
  executionId: { type: String, index: true },
  credentialId: { type: mongoose.Schema.Types.ObjectId, ref: "Credential", default: null },
  direction: {
    type: String,
    enum: ["outbound", "inbound"],
    required: true,
    index: true
  },
  providerMode: {
    type: String,
    enum: ["bot_api", "mtproto"],
    default: "bot_api",
    index: true
  },
  operation: { type: String, index: true },
  status: {
    type: String,
    enum: ["queued", "sent", "delivered", "failed"],
    default: "queued",
    index: true
  },
  telegram: {
    botId: { type: String, index: true },
    updateId: { type: Number, index: true },
    chatId: { type: String, index: true },
    chatType: { type: String },
    threadId: { type: String },
    fromId: { type: String },
    messageId: { type: String, index: true }
  },
  payloadRaw: { type: mongoose.Schema.Types.Mixed, default: null },
  payloadNormalized: { type: mongoose.Schema.Types.Mixed, default: null },
  error: { type: String },
  requestHash: { type: String, index: true },
  dedupeKey: { type: String, index: true },
  sentAt: { type: Date },
  createdAt: { type: Date, default: Date.now, index: true }
});

telegramEventSchema.index({ userId: 1, createdAt: -1 });
telegramEventSchema.index({ runId: 1, stepId: 1, iteration: 1, createdAt: -1 });
telegramEventSchema.index(
  { providerMode: 1, "telegram.botId": 1, "telegram.updateId": 1 },
  { unique: true, sparse: true }
);
telegramEventSchema.index({ executionId: 1, operation: 1, "telegram.chatId": 1, requestHash: 1 });

export const TelegramEvent = mongoose.model("TelegramEvent", telegramEventSchema);

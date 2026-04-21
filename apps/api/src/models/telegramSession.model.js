import mongoose from "mongoose";

const telegramSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  credentialId: { type: mongoose.Schema.Types.ObjectId, ref: "Credential", required: true, index: true },
  providerMode: {
    type: String,
    enum: ["mtproto"],
    default: "mtproto"
  },
  sessionId: { type: String, required: true, index: true },
  dcId: { type: Number },
  authKeyEncrypted: { type: String, required: true },
  deviceInfo: {
    appVersion: String,
    deviceModel: String,
    systemVersion: String,
    langCode: String
  },
  twoFactorState: {
    enabled: { type: Boolean, default: false },
    hint: { type: String },
    verifiedAt: { type: Date }
  },
  status: {
    type: String,
    enum: ["active", "paused", "revoked"],
    default: "active",
    index: true
  },
  lastUsedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

telegramSessionSchema.index({ userId: 1, status: 1, lastUsedAt: -1 });
telegramSessionSchema.index({ credentialId: 1, sessionId: 1 }, { unique: true });

telegramSessionSchema.pre("save", function onSave(next) {
  this.updatedAt = new Date();
  next();
});

export const TelegramSession = mongoose.model("TelegramSession", telegramSessionSchema);

import mongoose from "mongoose";

const stepSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { type: String, required: true },
  params: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  retry: { type: Number, default: 0 },
  retryDelay: { type: Number }, // ms to wait before each retry (optional; else exponential backoff)
  dependsOn: { type: [String], default: [] },
  /** When set, this step is reached from a switch node's output handle; only run when switch output.branch matches. */
  branch: { type: String },
  /** When set, this step is connected from the error port of the given stepId; runs when that step fails after retries. */
  errorFrom: { type: String },
  timeout: { type: Number, default: 0 },
  disabled: { type: Boolean, default: false }
}, { _id: false });

const versionSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  steps: { type: [stepSchema], required: true },
  maxParallel: { type: Number, default: 5 },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const workflowSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true },
  enabled: { type: Boolean, default: true },

  trigger: {
    type: {
      type: String,
      enum: ["manual", "cron", "trigger.webhook", "trigger.telegram"],
      default: "manual"
    },
    cron: { type: String },
    schedule: { type: String },
    timezone: { type: String },
    credentialId: { type: mongoose.Schema.Types.ObjectId, ref: "Credential" },
    allowedUpdates: { type: [String], default: [] },
    webhookSecret: { type: String },
    signatureRequired: { type: Boolean, default: false },
    signatureSecret: { type: String }
  },

  /**
   * Optional workflow-level fallback error handler.
   * When a step fails and no step-level `errorFrom` handlers exist,
   * the orchestrator can route execution to this stepId.
   */
  onErrorStepId: { type: String },

  // 🔹 ACTIVE SNAPSHOT (legacy + convenience)
  steps: { type: [stepSchema], default: [] },
  maxParallel: { type: Number, default: 5 },

  // 🔹 VERSIONING CORE
  currentVersion: { type: Number, default: 1 },
  versions: { type: [versionSchema], default: [] },
  tags: {
    type: [String],
    default: []
  },
  createdAt: { type: Date, default: Date.now }
});

export const Workflow = mongoose.model("Workflow", workflowSchema);
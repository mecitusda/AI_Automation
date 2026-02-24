import mongoose from "mongoose";

const stepStateSchema = new mongoose.Schema({
  stepId: { type: String, required: true },

  retryCount: { type: Number, default: 0 },

  status: {
    type: String,
    enum: ["pending", "running", "retrying", "completed", "failed", "skipped"],
    default: "pending"
  },

  startedAt: Date,
  finishedAt: Date,
  durationMs: Number

}, { _id: false });

const runSchema = new mongoose.Schema({
  workflowId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Workflow",
    required: true
  },

  status: {
    type: String,
    enum: ["queued", "running", "completed", "failed", "cancelled"],
    default: "queued"
  },

  currentStepIndex: {
    type: Number,
    default: 0
  },

  logs: [
    {
      stepId: String,
      message: String,
      level: {
        type: String,
        enum: ["info", "error", "retry", "system"],
        default: "info"
      },
      createdAt: { type: Date, default: Date.now }
    }
  ],

  stepStates: [stepStateSchema],
  processedMessages: {
    type: [String],
    default: []
  },
  outputs: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  durationMs: Number,
  createdAt: { type: Date, default: Date.now },
  finishedAt: Date
});

export const Run = mongoose.model("Run", runSchema);
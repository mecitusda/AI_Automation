import mongoose from "mongoose";


const stepSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { type: String, required: true },
  params: {
  type: mongoose.Schema.Types.Mixed,
  default: {}
  },
  retry: { type: Number, default: 0 },
  dependsOn: { type: [String], default: [] },
  timeout: { type: Number, default: 0 },
  disabled: { type: Boolean, default: false }
}, { _id: false });

const stepStateSchema = new mongoose.Schema({

  stepId: { type: String, required: true },

  iteration: { type: Number, default: 0 }, // 🔥 YENİ

  executionId: { type: String },

  retryCount: { type: Number, default: 0 },

  status: {
    type: String,
    enum: [
      "pending",
      "running",
      "retrying",
      "completed",
      "failed",
      "skipped",
      "cancelled"
    ],
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

  /* 🔹 FOREACH LOOP STATE */

  loopState: {
    type: Map,
    of: {
      index: { type: Number, default: 0 },
      items: { type: [mongoose.Schema.Types.Mixed], default: [] }
    },
    default: {}
  },

  /* 🔹 ACTIVE LOOP CONTEXT */

  loopContext: {
    loopStepId: String,
    item: mongoose.Schema.Types.Mixed,
    index: Number
  },

  /* 🔹 TRIGGER DATA */

  triggerPayload: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  processedMessages: {
    type: [String],
    default: []
  },
  stepStates: [stepStateSchema],

  outputs: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },

  /** Set when execution is routed to an error-handler step; cleared after handler runs. */
  lastError: {
    stepId: String,
    message: String,
    iteration: Number
  },

  logs: [
    {
      stepId: String,
      message: String,
      level: {
        type: String,
        enum: ["info", "warning", "error", "retry", "system"],
        default: "info"
      },
      createdAt: { type: Date, default: Date.now }
    }
  ],

  durationMs: Number,

  workflowVersion: { type: Number, required: true },

  workflowSnapshot: {
    steps: { type: [stepSchema], required: true },
    maxParallel: { type: Number, default: 5 },
    version: { type: Number }
  },

  createdAt: { type: Date, default: Date.now },
  finishedAt: Date
});


runSchema.index({ workflowId: 1 });
runSchema.index({ status: 1 });
runSchema.index({ createdAt: -1 });
runSchema.index({ "stepStates.stepId": 1,
                  "stepStates.iteration": 1
});
export const Run = mongoose.model("Run", runSchema);
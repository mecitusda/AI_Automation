import mongoose from "mongoose";


const stepSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { type: String, required: true },
  params: {
  type: mongoose.Schema.Types.Mixed,
  default: {}
  },
  retry: { type: Number, default: 0 },
  retryDelay: { type: Number },
  dependsOn: { type: [String], default: [] },
  dependencyModes: {
    type: Map,
    of: { type: String, enum: ["iteration", "barrier"] },
    default: {}
  },
  branch: { type: String },
  errorFrom: { type: String },
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
  queuedAt: Date,
  finishedAt: Date,
  durationMs: Number

}, { _id: false });

const runSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

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

  /**
   * Per step execution resolved params (redacted), keyed by `${stepId}::${iteration}`.
   * Used for execution inspector (e.g. AI prompt after variable resolution).
   */
  stepInputs: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },

  /** Set when execution is routed to an error-handler step; cleared after handler runs. */
  lastError: {
    stepId: String,
    message: String,
    iteration: Number,
    attempt: Number
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
      status: { type: String },
      durationMs: { type: Number },
      attempt: { type: Number },
      error: { type: String },
      createdAt: { type: Date, default: Date.now }
    }
  ],

  durationMs: Number,

  workflowVersion: { type: Number, required: true },

  workflowSnapshot: {
    steps: { type: [stepSchema], required: true },
    maxParallel: { type: Number, default: 5 },
    version: { type: Number },
    onErrorStepId: { type: String }
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
export function getRunModel(conn = mongoose.connection) {
  return conn.models.Run || conn.model("Run", runSchema);
}

export const Run = getRunModel();
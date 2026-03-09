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
  timeout: { type: Number, default: 0 }
}, { _id: false });

const versionSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  steps: { type: [stepSchema], required: true },
  maxParallel: { type: Number, default: 5 },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const workflowSchema = new mongoose.Schema({
  name: { type: String, required: true },
  enabled: { type: Boolean, default: true },

  trigger: {
    type: {
      type: String,
      enum: ["manual", "cron"],
      default: "manual"
    },
    cron: { type: String }
  },

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
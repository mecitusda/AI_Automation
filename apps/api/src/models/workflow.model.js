import mongoose from "mongoose";

const stepSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { type: String, required: true },
  params: { type: Object, default: {} },

  retry: {
    type: Number,
    default: 0
  },
  dependsOn: { type: [String], default: [] },
  timeout: {
    type: Number, // ms cinsinden
    default: 0
  },
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
  steps: [stepSchema],
   maxParallel: {
    type: Number,
    default: 5
  },
  createdAt: { type: Date, default: Date.now }
});

export const Workflow = mongoose.model("Workflow", workflowSchema);
import mongoose from "mongoose";

const workflowVariableSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  workflowId: { type: mongoose.Schema.Types.ObjectId, ref: "Workflow", required: true, index: true },
  key: { type: String, required: true, trim: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
  valueType: {
    type: String,
    enum: ["string", "number", "boolean", "json", "null"],
    default: "json"
  },
  isSecret: { type: Boolean, default: false },
  description: { type: String, default: "" },
  tags: { type: [String], default: [] },
  lastUsedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

workflowVariableSchema.index(
  { userId: 1, workflowId: 1, key: 1 },
  { unique: true }
);
workflowVariableSchema.index({ userId: 1, workflowId: 1, createdAt: -1 });

workflowVariableSchema.pre("save", function onSave(next) {
  this.updatedAt = new Date();
  next();
});

export function getWorkflowVariableModel(conn = mongoose.connection) {
  return conn.models.WorkflowVariable || conn.model("WorkflowVariable", workflowVariableSchema);
}

export const WorkflowVariable = getWorkflowVariableModel();

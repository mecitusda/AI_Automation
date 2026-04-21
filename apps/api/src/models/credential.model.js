import mongoose from "mongoose";

const credentialSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true },
  type: { type: String, required: true },
  data: { type: String, required: true },
  accessCount: { type: Number, default: 0 },
  lastAccessAt: { type: Date },
  rotatedAt: { type: Date },
  lastUsedByRunId: { type: mongoose.Schema.Types.ObjectId, ref: "Run" },
  lastUsedInWorkflowId: { type: mongoose.Schema.Types.ObjectId, ref: "Workflow" },
  createdAt: { type: Date, default: Date.now }
});

credentialSchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.data;
    return ret;
  }
});

export const Credential = mongoose.model("Credential", credentialSchema);

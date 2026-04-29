import mongoose from "mongoose";

const workflowVariableSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  // workflowId is required only when scope === "workflow". For user-scope
  // entries it is null and the document is shared across all workflows of
  // the same user.
  workflowId: { type: mongoose.Schema.Types.ObjectId, ref: "Workflow", default: null, index: true },
  scope: {
    type: String,
    enum: ["workflow", "user"],
    default: "workflow",
    index: true
  },
  collection: {
    type: String,
    default: "",
    trim: true,
    lowercase: true,
    index: true
  },
  key: { type: String, required: true, trim: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
  valueType: {
    type: String,
    enum: ["string", "number", "boolean", "json", "null", "array"],
    default: "json"
  },
  isSecret: { type: Boolean, default: false },
  description: { type: String, default: "" },
  tags: { type: [String], default: [] },
  lastUsedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Two partial unique indexes so that the same key can coexist in different
// scopes / collections without colliding.
workflowVariableSchema.index(
  { userId: 1, scope: 1, collection: 1, key: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: "user" },
    name: "uniq_userScope_key"
  }
);
workflowVariableSchema.index(
  { userId: 1, workflowId: 1, scope: 1, collection: 1, key: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: "workflow" },
    name: "uniq_workflowScope_key"
  }
);
workflowVariableSchema.index({ userId: 1, workflowId: 1, createdAt: -1 });
workflowVariableSchema.index({ userId: 1, scope: 1, collection: 1, createdAt: -1 });

workflowVariableSchema.pre("save", function onSave() {
  this.updatedAt = new Date();
});

/**
 * Backfills `scope` and `collection` on legacy documents that predate the
 * scope/collection feature. Required so that the new partial unique indexes
 * cover them and so that scope-aware queries (`{scope:"workflow"}`) can find
 * them.
 */
async function backfillLegacyDocs(model) {
  try {
    await model.collection.updateMany(
      { scope: { $exists: false } },
      { $set: { scope: "workflow", collection: "" } }
    );
    await model.collection.updateMany(
      { collection: { $exists: false } },
      { $set: { collection: "" } }
    );
  } catch (err) {
    void err;
  }
}

/**
 * Drops the legacy `{ userId, workflowId, key }` unique index if it still
 * exists. Safe to call multiple times. Should be invoked after the new
 * partial indexes are in place so we never lose write protection during the
 * migration window.
 */
async function dropLegacyUniqueIndex(model) {
  try {
    const indexes = await model.collection.indexes();
    const legacy = indexes.find(
      (idx) =>
        idx.unique === true &&
        !idx.partialFilterExpression &&
        idx.key &&
        idx.key.userId === 1 &&
        idx.key.workflowId === 1 &&
        idx.key.key === 1 &&
        Object.keys(idx.key).length === 3
    );
    if (legacy?.name) {
      await model.collection.dropIndex(legacy.name);
    }
  } catch (err) {
    void err;
  }
}

export function getWorkflowVariableModel(conn = mongoose.connection) {
  if (conn.models.WorkflowVariable) {
    return conn.models.WorkflowVariable;
  }
  const model = conn.model("WorkflowVariable", workflowVariableSchema);
  // Fire-and-forget migration: backfill scope/collection on legacy docs,
  // wait for the new partial indexes, then drop the legacy unique index.
  // Order matters: backfill must happen before partial indexes are built so
  // that legacy docs are picked up by the new partial filters.
  (async () => {
    try {
      await backfillLegacyDocs(model);
      await model.init();
      await dropLegacyUniqueIndex(model);
    } catch {
      /* ignore */
    }
  })();
  return model;
}

export const WorkflowVariable = getWorkflowVariableModel();

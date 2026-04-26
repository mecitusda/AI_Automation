import { getWorkflowVariableAccess } from "../utils/dbPluginStore.js";

function detectValueType(value) {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "json";
}

export default {
  type: "db.set",
  label: "Data Store Set",
  category: "data",
  schema: [
    { key: "key", type: "string", label: "Key", required: true, placeholder: "customer.status" },
    { key: "value", type: "json", label: "Value", required: true, placeholder: "{\"ok\":true}" },
    { key: "isSecret", type: "boolean", label: "Secret", default: false },
    { key: "description", type: "string", label: "Description", placeholder: "Optional note" },
    { key: "tags", type: "string", label: "Tags (comma separated)", placeholder: "crm,customer" }
  ],
  output: {
    type: "object",
    properties: {
      key: { type: "string" },
      upserted: { type: "boolean" },
      value: {},
      valueType: { type: "string" }
    }
  },
  validate: (params) => {
    const err = {};
    if (!params?.key || String(params.key).trim() === "") err.key = "Key is required";
    if (params?.value === undefined) err.value = "Value is required";
    return err;
  },
  executor: async ({ params, context }) => {
    const { WorkflowVariable, baseQuery } = getWorkflowVariableAccess(context);
    const key = String(params.key).trim();
    const value = params.value;
    const tags = String(params.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const existing = await WorkflowVariable.findOne({ ...baseQuery, key }).select({ _id: 1 }).lean();
    const updated = await WorkflowVariable.findOneAndUpdate(
      { ...baseQuery, key },
      {
        $set: {
          value,
          valueType: detectValueType(value),
          isSecret: Boolean(params.isSecret),
          description: String(params.description || ""),
          tags,
          updatedAt: new Date()
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return {
      success: true,
      output: {
        key,
        upserted: !existing,
        value,
        valueType: updated?.valueType || detectValueType(value)
      },
      meta: {}
    };
  }
};

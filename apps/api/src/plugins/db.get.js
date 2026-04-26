import { getWorkflowVariableAccess } from "../utils/dbPluginStore.js";

export default {
  type: "db.get",
  label: "Data Store Get",
  category: "data",
  schema: [
    { key: "key", type: "string", label: "Key (exact)", required: true, placeholder: "customer.status" },
    { key: "defaultValue", type: "json", label: "Default value", placeholder: "null" }
  ],
  output: {
    type: "object",
    properties: {
      key: { type: "string" },
      found: { type: "boolean" },
      value: {},
      valueType: { type: "string" }
    }
  },
  validate: (params) => {
    const err = {};
    if (!params?.key || String(params.key).trim() === "") {
      err.key = "Key is required for db.get (use db.query for listing/filtering)";
    }
    return err;
  },
  executor: async ({ params, context }) => {
    const { WorkflowVariable, baseQuery } = getWorkflowVariableAccess(context);
    const key = String(params.key).trim();
    const doc = await WorkflowVariable.findOne({ ...baseQuery, key }).lean();
    if (doc) {
      await WorkflowVariable.updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() } });
    }
    const found = Boolean(doc);
    return {
      success: true,
      output: {
        key,
        found,
        value: found ? doc.value : params.defaultValue ?? null,
        valueType: found ? doc.valueType : null
      },
      meta: {}
    };
  }
};

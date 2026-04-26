import { getWorkflowVariableAccess } from "../utils/dbPluginStore.js";

export default {
  type: "db.delete",
  label: "Data Store Delete",
  category: "data",
  schema: [
    { key: "key", type: "string", label: "Key", required: true, placeholder: "customer.status" }
  ],
  output: {
    type: "object",
    properties: {
      key: { type: "string" },
      deletedCount: { type: "number" }
    }
  },
  validate: (params) => {
    const err = {};
    if (!params?.key || String(params.key).trim() === "") err.key = "Key is required";
    return err;
  },
  executor: async ({ params, context }) => {
    const { WorkflowVariable, baseQuery } = getWorkflowVariableAccess(context);
    const key = String(params.key).trim();
    const result = await WorkflowVariable.deleteOne({ ...baseQuery, key });
    return {
      success: true,
      output: {
        key,
        deletedCount: result?.deletedCount || 0
      },
      meta: {}
    };
  }
};

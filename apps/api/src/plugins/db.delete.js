import { getWorkflowVariableAccess } from "../utils/dbPluginStore.js";

const VALID_DELETE_MODES = new Set(["single", "byCollection", "byKeyPrefix"]);

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default {
  type: "db.delete",
  label: "Data Store Delete",
  category: "data",
  schema: [
    {
      key: "scope",
      type: "select",
      label: "Scope",
      default: "workflow",
      options: [
        { value: "workflow", label: "Workflow" },
        { value: "user", label: "User (shared across workflows)" }
      ]
    },
    {
      key: "collection",
      type: "string",
      label: "Collection",
      placeholder: "news, customers"
    },
    {
      key: "mode",
      type: "select",
      label: "Delete Mode",
      default: "single",
      options: [
        { value: "single", label: "Single key" },
        { value: "byCollection", label: "Entire collection" },
        { value: "byKeyPrefix", label: "By key prefix" }
      ]
    },
    { key: "key", type: "string", label: "Key (single mode)", placeholder: "customer.status" },
    { key: "keyPrefix", type: "string", label: "Key Prefix (byKeyPrefix mode)", placeholder: "news.2024." }
  ],
  output: {
    type: "object",
    properties: {
      key: { type: "string" },
      scope: { type: "string" },
      collection: { type: "string" },
      mode: { type: "string" },
      deletedCount: { type: "number" }
    }
  },
  validate: (params) => {
    const err = {};
    const mode = String(params?.mode || "single");
    if (!VALID_DELETE_MODES.has(mode)) {
      err.mode = `Invalid mode (must be one of ${Array.from(VALID_DELETE_MODES).join(", ")})`;
    }
    if (mode === "single" && (!params?.key || String(params.key).trim() === "")) {
      err.key = "Key is required for single mode";
    }
    if (mode === "byKeyPrefix" && (!params?.keyPrefix || String(params.keyPrefix).trim() === "")) {
      err.keyPrefix = "keyPrefix is required for byKeyPrefix mode";
    }
    return err;
  },
  executor: async ({ params, context }) => {
    const scope = String(params?.scope || "workflow");
    const collection = String(params?.collection || "");
    const mode = String(params?.mode || "single");
    const { WorkflowVariable, baseQuery, scope: scopeInfo } = getWorkflowVariableAccess(context, {
      scope,
      collection
    });

    let deletedCount = 0;
    let key = "";

    if (mode === "single") {
      key = String(params.key).trim();
      const result = await WorkflowVariable.deleteOne({ ...baseQuery, key });
      deletedCount = result?.deletedCount || 0;
    } else if (mode === "byCollection") {
      const result = await WorkflowVariable.deleteMany({ ...baseQuery });
      deletedCount = result?.deletedCount || 0;
    } else if (mode === "byKeyPrefix") {
      const prefix = String(params.keyPrefix).trim();
      const result = await WorkflowVariable.deleteMany({
        ...baseQuery,
        key: { $regex: `^${escapeRegex(prefix)}` }
      });
      deletedCount = result?.deletedCount || 0;
    }

    return {
      success: true,
      output: {
        key,
        scope: scopeInfo.scope,
        collection: scopeInfo.collection,
        mode,
        deletedCount
      },
      meta: {}
    };
  }
};

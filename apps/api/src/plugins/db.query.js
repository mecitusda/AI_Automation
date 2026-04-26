import { getWorkflowVariableAccess } from "../utils/dbPluginStore.js";

export default {
  type: "db.query",
  label: "Data Store Query",
  category: "data",
  schema: [
    { key: "keyPrefix", type: "string", label: "Key prefix", placeholder: "customer." },
    { key: "tag", type: "string", label: "Tag", placeholder: "crm" },
    {
      key: "createdWithin",
      type: "select",
      label: "Created within",
      default: "all",
      options: [
        { value: "all", label: "All time" },
        { value: "today", label: "Today" },
        { value: "last24h", label: "Last 24 hours" }
      ]
    },
    { key: "includeSecrets", type: "boolean", label: "Include secrets", default: false },
    { key: "limit", type: "number", label: "Limit", default: 50 }
  ],
  output: {
    type: "object",
    properties: {
      count: { type: "number" },
      rows: { type: "array" }
    }
  },
  validate: (params) => {
    const err = {};
    const limit = Number(params?.limit ?? 50);
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      err.limit = "Limit must be between 1 and 200";
    }
    return err;
  },
  executor: async ({ params, context }) => {
    const { WorkflowVariable, baseQuery } = getWorkflowVariableAccess(context);
    const q = { ...baseQuery };
    const keyPrefix = String(params.keyPrefix || "").trim();
    const tag = String(params.tag || "").trim();
    const createdWithin = String(params.createdWithin || "all");
    const includeSecrets = Boolean(params.includeSecrets);
    const limit = Math.max(1, Math.min(200, Number(params.limit || 50)));

    if (keyPrefix) q.key = { $regex: `^${keyPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` };
    if (tag) q.tags = tag;
    if (createdWithin === "today") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      q.createdAt = { $gte: start };
    } else if (createdWithin === "last24h") {
      q.createdAt = { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };
    }

    const docs = await WorkflowVariable.find(q)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    const rows = docs.map((d) => ({
      id: d._id.toString(),
      key: d.key,
      value: d.isSecret && !includeSecrets ? "[REDACTED]" : d.value,
      valueType: d.valueType,
      isSecret: d.isSecret,
      tags: d.tags || [],
      updatedAt: d.updatedAt
    }));

    return {
      success: true,
      output: {
        count: rows.length,
        rows
      },
      meta: {}
    };
  }
};

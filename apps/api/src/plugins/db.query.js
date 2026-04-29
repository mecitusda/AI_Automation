import { getWorkflowVariableAccess } from "../utils/dbPluginStore.js";

const ALLOWED_OPERATORS = new Set([
  "$eq",
  "$ne",
  "$in",
  "$nin",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$regex",
  "$exists"
]);

function isPlainObject(obj) {
  return Object.prototype.toString.call(obj) === "[object Object]";
}

/**
 * Validates and rewrites a user-supplied `valueFilter` expression so that
 * it can safely be merged into the mongo query. Each entry's key is treated
 * as a dotted path inside the stored `value`, prefixed with `value.` before
 * being merged. Operators are whitelisted to prevent injection of `$where`,
 * `$expr`, etc.
 */
function buildValueFilterQuery(rawFilter) {
  if (rawFilter == null) return {};
  let parsed = rawFilter;
  if (typeof rawFilter === "string") {
    const s = rawFilter.trim();
    if (!s) return {};
    try {
      parsed = JSON.parse(s);
    } catch (err) {
      throw new Error(`valueFilter is not valid JSON: ${err?.message || err}`);
    }
  }
  if (!isPlainObject(parsed)) {
    throw new Error("valueFilter must be an object mapping path -> matcher");
  }

  const out = {};
  for (const [path, matcher] of Object.entries(parsed)) {
    if (typeof path !== "string" || path.startsWith("$")) {
      throw new Error(`valueFilter key '${path}' is not allowed`);
    }
    const fullPath = `value.${path}`;
    if (matcher == null || typeof matcher !== "object" || Array.isArray(matcher)) {
      out[fullPath] = matcher;
      continue;
    }
    const sub = {};
    for (const [op, val] of Object.entries(matcher)) {
      if (!op.startsWith("$")) {
        throw new Error(`valueFilter operator '${op}' must start with '$'`);
      }
      if (!ALLOWED_OPERATORS.has(op)) {
        throw new Error(`valueFilter operator '${op}' is not allowed`);
      }
      sub[op] = val;
    }
    out[fullPath] = sub;
  }
  return out;
}

export default {
  type: "db.query",
  label: "Data Store Query",
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
    { key: "keyPrefix", type: "string", label: "Key prefix", placeholder: "customer." },
    { key: "tag", type: "string", label: "Tag", placeholder: "crm" },
    {
      key: "valueFilter",
      type: "json",
      label: "Value filter (JSON)",
      placeholder: "{\"url\": {\"$regex\": \"haber.com\"}}"
    },
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
    {
      key: "sortBy",
      type: "select",
      label: "Sort by",
      default: "updatedAt",
      options: [
        { value: "updatedAt", label: "Updated at" },
        { value: "createdAt", label: "Created at" },
        { value: "key", label: "Key" }
      ]
    },
    {
      key: "sortDir",
      type: "select",
      label: "Sort direction",
      default: "desc",
      options: [
        { value: "desc", label: "Descending" },
        { value: "asc", label: "Ascending" }
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
    if (params?.valueFilter !== undefined && params.valueFilter !== "" && params.valueFilter !== null) {
      try {
        buildValueFilterQuery(params.valueFilter);
      } catch (e) {
        err.valueFilter = e?.message || String(e);
      }
    }
    return err;
  },
  executor: async ({ params, context }) => {
    const scope = String(params?.scope || "workflow");
    const collection = String(params?.collection || "");
    const { WorkflowVariable, baseQuery } = getWorkflowVariableAccess(context, { scope, collection });
    const q = { ...baseQuery };
    const keyPrefix = String(params.keyPrefix || "").trim();
    const tag = String(params.tag || "").trim();
    const createdWithin = String(params.createdWithin || "all");
    const includeSecrets = Boolean(params.includeSecrets);
    const limit = Math.max(1, Math.min(200, Number(params.limit || 50)));
    const sortBy = String(params.sortBy || "updatedAt");
    const sortDir = String(params.sortDir || "desc") === "asc" ? 1 : -1;

    if (keyPrefix) q.key = { $regex: `^${keyPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` };
    if (tag) q.tags = tag;
    if (createdWithin === "today") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      q.createdAt = { $gte: start };
    } else if (createdWithin === "last24h") {
      q.createdAt = { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };
    }

    if (params.valueFilter !== undefined && params.valueFilter !== "" && params.valueFilter !== null) {
      const valueQ = buildValueFilterQuery(params.valueFilter);
      Object.assign(q, valueQ);
    }

    const allowedSort = new Set(["updatedAt", "createdAt", "key"]);
    const sortField = allowedSort.has(sortBy) ? sortBy : "updatedAt";

    const docs = await WorkflowVariable.find(q)
      .sort({ [sortField]: sortDir })
      .limit(limit)
      .lean();

    const rows = docs.map((d) => ({
      id: d._id.toString(),
      key: d.key,
      scope: d.scope || "workflow",
      collection: d.collection || "",
      value: d.isSecret && !includeSecrets ? "[REDACTED]" : d.value,
      valueType: d.valueType,
      isSecret: d.isSecret,
      tags: d.tags || [],
      updatedAt: d.updatedAt,
      createdAt: d.createdAt
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

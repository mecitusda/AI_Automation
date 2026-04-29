import { detectValueType, getWorkflowVariableAccess } from "../utils/dbPluginStore.js";

const VALID_WRITE_MODES = new Set([
  "upsert",
  "insertOnly",
  "updateOnly",
  "skipIfExists",
  "append"
]);

/**
 * Resolves a dot-separated path on a (possibly nested) object/array. Returns
 * `undefined` if any segment is missing.
 */
function resolvePath(obj, path) {
  if (!path) return undefined;
  const segments = String(path)
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  let cur = obj;
  for (const seg of segments) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function parseTags(rawTags) {
  if (Array.isArray(rawTags)) {
    return rawTags.map((t) => String(t).trim()).filter(Boolean);
  }
  return String(rawTags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export default {
  type: "db.set",
  label: "Data Store Set",
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
    { key: "key", type: "string", label: "Key", required: true, placeholder: "customer.status" },
    { key: "value", type: "json", label: "Value", required: true, placeholder: "{\"ok\":true}" },
    {
      key: "writeMode",
      type: "select",
      label: "Write Mode",
      default: "upsert",
      options: [
        { value: "upsert", label: "Upsert (overwrite if exists)" },
        { value: "insertOnly", label: "Insert only (fail if exists)" },
        { value: "updateOnly", label: "Update only (fail if missing)" },
        { value: "skipIfExists", label: "Skip if exists" },
        { value: "append", label: "Append to array" }
      ]
    },
    {
      key: "matchOn",
      type: "string",
      label: "Match On (append dedup field)",
      placeholder: "url"
    },
    { key: "isSecret", type: "boolean", label: "Secret", default: false },
    { key: "description", type: "string", label: "Description", placeholder: "Optional note" },
    { key: "tags", type: "string", label: "Tags (comma separated)", placeholder: "crm,customer" }
  ],
  output: {
    type: "object",
    properties: {
      key: { type: "string" },
      scope: { type: "string" },
      collection: { type: "string" },
      writeMode: { type: "string" },
      upserted: { type: "boolean" },
      created: { type: "boolean" },
      updated: { type: "boolean" },
      skipped: { type: "boolean" },
      deduped: { type: "boolean" },
      appendedCount: { type: "number" },
      value: {},
      valueType: { type: "string" }
    }
  },
  validate: (params) => {
    const err = {};
    if (!params?.key || String(params.key).trim() === "") err.key = "Key is required";
    if (params?.value === undefined) err.value = "Value is required";
    const writeMode = params?.writeMode;
    if (writeMode && !VALID_WRITE_MODES.has(String(writeMode))) {
      err.writeMode = `Invalid writeMode (must be one of ${Array.from(VALID_WRITE_MODES).join(", ")})`;
    }
    return err;
  },
  executor: async ({ params, context }) => {
    const scope = String(params?.scope || "workflow");
    const collection = String(params?.collection || "");
    const writeMode = String(params?.writeMode || "upsert");
    const matchOn = String(params?.matchOn || "").trim();
    const { WorkflowVariable, baseQuery, scope: scopeInfo } = getWorkflowVariableAccess(context, {
      scope,
      collection
    });
    const key = String(params.key).trim();
    const value = params.value;
    const tags = parseTags(params.tags);
    const isSecret = Boolean(params.isSecret);
    const description = String(params.description || "");

    const baseDocFields = {
      isSecret,
      description,
      tags,
      updatedAt: new Date()
    };

    const result = {
      key,
      scope: scopeInfo.scope,
      collection: scopeInfo.collection,
      writeMode,
      upserted: false,
      created: false,
      updated: false,
      skipped: false,
      deduped: false,
      appendedCount: 0,
      value,
      valueType: detectValueType(value)
    };

    if (writeMode === "upsert") {
      const existing = await WorkflowVariable.findOne({ ...baseQuery, key }).select({ _id: 1 }).lean();
      const updated = await WorkflowVariable.findOneAndUpdate(
        { ...baseQuery, key },
        {
          $set: {
            ...baseDocFields,
            value,
            valueType: detectValueType(value)
          },
          $setOnInsert: {
            userId: scopeInfo.userId,
            workflowId: scopeInfo.workflowId,
            scope: scopeInfo.scope,
            collection: scopeInfo.collection,
            key,
            createdAt: new Date()
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();
      result.upserted = !existing;
      result.created = !existing;
      result.updated = Boolean(existing);
      result.value = updated?.value;
      result.valueType = updated?.valueType || detectValueType(value);
      return { success: true, output: result, meta: {} };
    }

    if (writeMode === "insertOnly") {
      const existing = await WorkflowVariable.findOne({ ...baseQuery, key }).select({ _id: 1 }).lean();
      if (existing) {
        return {
          success: false,
          error: `Key '${key}' already exists in scope '${scopeInfo.scope}'/collection '${scopeInfo.collection}'`,
          output: { ...result, skipped: false },
          meta: {}
        };
      }
      const created = await WorkflowVariable.create({
        userId: scopeInfo.userId,
        workflowId: scopeInfo.workflowId,
        scope: scopeInfo.scope,
        collection: scopeInfo.collection,
        key,
        value,
        valueType: detectValueType(value),
        ...baseDocFields
      });
      result.created = true;
      result.upserted = true;
      result.value = created.value;
      result.valueType = created.valueType;
      return { success: true, output: result, meta: {} };
    }

    if (writeMode === "updateOnly") {
      const updated = await WorkflowVariable.findOneAndUpdate(
        { ...baseQuery, key },
        {
          $set: {
            ...baseDocFields,
            value,
            valueType: detectValueType(value)
          }
        },
        { new: true }
      ).lean();
      if (!updated) {
        return {
          success: false,
          error: `Key '${key}' not found in scope '${scopeInfo.scope}'/collection '${scopeInfo.collection}'`,
          output: result,
          meta: {}
        };
      }
      result.updated = true;
      result.value = updated.value;
      result.valueType = updated.valueType;
      return { success: true, output: result, meta: {} };
    }

    if (writeMode === "skipIfExists") {
      const existing = await WorkflowVariable.findOne({ ...baseQuery, key }).select({ _id: 1 }).lean();
      if (existing) {
        result.skipped = true;
        return { success: true, output: result, meta: {} };
      }
      const created = await WorkflowVariable.create({
        userId: scopeInfo.userId,
        workflowId: scopeInfo.workflowId,
        scope: scopeInfo.scope,
        collection: scopeInfo.collection,
        key,
        value,
        valueType: detectValueType(value),
        ...baseDocFields
      });
      result.created = true;
      result.upserted = true;
      result.value = created.value;
      result.valueType = created.valueType;
      return { success: true, output: result, meta: {} };
    }

    if (writeMode === "append") {
      const itemsToPush = Array.isArray(value) ? value : [value];
      const existing = await WorkflowVariable.findOne({ ...baseQuery, key }).lean();
      let appendedCount = 0;
      let dedupedCount = 0;

      if (!existing) {
        const initial = [];
        for (const item of itemsToPush) {
          if (matchOn) {
            const candidateMatch = resolvePath(item, matchOn);
            const dupInBatch = initial.some(
              (it) => candidateMatch !== undefined && resolvePath(it, matchOn) === candidateMatch
            );
            if (dupInBatch) {
              dedupedCount += 1;
              continue;
            }
          }
          initial.push(item);
          appendedCount += 1;
        }
        const created = await WorkflowVariable.create({
          userId: scopeInfo.userId,
          workflowId: scopeInfo.workflowId,
          scope: scopeInfo.scope,
          collection: scopeInfo.collection,
          key,
          value: initial,
          valueType: "array",
          ...baseDocFields
        });
        result.created = true;
        result.upserted = true;
        result.appendedCount = appendedCount;
        result.deduped = dedupedCount > 0;
        result.value = created.value;
        result.valueType = "array";
        return { success: true, output: result, meta: { dedupedCount } };
      }

      const currentArr = Array.isArray(existing.value) ? [...existing.value] : [existing.value];
      for (const item of itemsToPush) {
        if (matchOn) {
          const candidateMatch = resolvePath(item, matchOn);
          if (candidateMatch !== undefined) {
            const dup = currentArr.some(
              (it) => resolvePath(it, matchOn) === candidateMatch
            );
            if (dup) {
              dedupedCount += 1;
              continue;
            }
          }
        }
        currentArr.push(item);
        appendedCount += 1;
      }

      const updated = await WorkflowVariable.findOneAndUpdate(
        { ...baseQuery, key },
        {
          $set: {
            ...baseDocFields,
            value: currentArr,
            valueType: "array"
          }
        },
        { new: true }
      ).lean();

      result.updated = true;
      result.appendedCount = appendedCount;
      result.deduped = dedupedCount > 0;
      result.value = updated?.value || currentArr;
      result.valueType = "array";
      return { success: true, output: result, meta: { dedupedCount } };
    }

    return {
      success: false,
      error: `Unknown writeMode: ${writeMode}`,
      output: result,
      meta: {}
    };
  }
};

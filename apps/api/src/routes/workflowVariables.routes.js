import express from "express";
import mongoose from "mongoose";
import { getPlatformModels } from "../utils/tenantModels.js";

const router = express.Router();

const modelsOf = () => getPlatformModels();

const VALID_SCOPES = new Set(["workflow", "user", "all"]);

function parseLimit(raw, fallback = 50) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function parsePage(raw, fallback = 1) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function detectValueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "json";
}

function normalizeScope(value, fallback = "workflow") {
  const s = String(value ?? fallback).trim().toLowerCase();
  if (!VALID_SCOPES.has(s)) return fallback;
  return s;
}

function normalizeCollection(value) {
  return String(value ?? "").trim().toLowerCase();
}

async function ensureWorkflowOwnership(req, workflowId) {
  if (!mongoose.isValidObjectId(workflowId)) return false;
  const { Workflow } = modelsOf(req);
  const wf = await Workflow.findOne({
    _id: workflowId,
    userId: req.user.id
  }).select({ _id: 1 }).lean();
  return Boolean(wf);
}

function serializeItem(item, { redact = true } = {}) {
  return {
    id: item._id.toString(),
    workflowId: item.workflowId ? item.workflowId.toString() : null,
    scope: item.scope || "workflow",
    collection: item.collection || "",
    key: item.key,
    value: redact && item.isSecret ? "[REDACTED]" : item.value,
    valueType: item.valueType,
    isSecret: item.isSecret,
    description: item.description || "",
    tags: item.tags || [],
    updatedAt: item.updatedAt,
    createdAt: item.createdAt
  };
}

router.get("/", async (req, res) => {
  try {
    const { WorkflowVariable } = modelsOf(req);
    const scope = normalizeScope(req.query.scope, "workflow");
    const workflowId = String(req.query.workflowId || "");
    const collectionFilter = normalizeCollection(req.query.collection);

    const q = { userId: req.user.id };

    if (scope === "user") {
      q.scope = "user";
    } else if (scope === "workflow") {
      if (!workflowId) {
        return res.status(400).json({ error: "workflowId is required for workflow scope" });
      }
      if (!(await ensureWorkflowOwnership(req, workflowId))) {
        return res.status(404).json({ error: "Workflow not found" });
      }
      q.scope = "workflow";
      q.workflowId = workflowId;
    } else if (scope === "all") {
      // Optional workflowId narrows the workflow-scoped subset.
      if (workflowId) {
        if (!(await ensureWorkflowOwnership(req, workflowId))) {
          return res.status(404).json({ error: "Workflow not found" });
        }
        q.$or = [
          { scope: "user" },
          { scope: "workflow", workflowId }
        ];
      }
    }

    if (req.query.collection !== undefined) {
      q.collection = collectionFilter;
    }

    const keyFilter = String(req.query.key || "").trim();
    const textFilter = String(req.query.q || "").trim();
    if (keyFilter) q.key = keyFilter;
    if (textFilter) {
      const orConds = [
        { key: { $regex: textFilter, $options: "i" } },
        { description: { $regex: textFilter, $options: "i" } }
      ];
      if (q.$or) {
        q.$and = [{ $or: q.$or }, { $or: orConds }];
        delete q.$or;
      } else {
        q.$or = orConds;
      }
    }

    const limit = parseLimit(req.query.limit, 50);
    const page = parsePage(req.query.page, 1);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      WorkflowVariable.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      WorkflowVariable.countDocuments(q)
    ]);

    return res.json({
      items: items.map((it) => serializeItem(it)),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

router.get("/collections", async (req, res) => {
  try {
    const { WorkflowVariable } = modelsOf(req);
    const scope = normalizeScope(req.query.scope, "workflow");
    const workflowId = String(req.query.workflowId || "");
    const match = { userId: new mongoose.Types.ObjectId(req.user.id) };
    if (scope === "user") match.scope = "user";
    else if (scope === "workflow") {
      if (!workflowId) {
        return res.status(400).json({ error: "workflowId is required for workflow scope" });
      }
      if (!(await ensureWorkflowOwnership(req, workflowId))) {
        return res.status(404).json({ error: "Workflow not found" });
      }
      match.scope = "workflow";
      match.workflowId = new mongoose.Types.ObjectId(workflowId);
    }
    const collections = await WorkflowVariable.distinct("collection", match);
    return res.json({ collections: collections.filter((c) => c != null) });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

router.post("/", async (req, res) => {
  try {
    const { WorkflowVariable } = modelsOf(req);
    const {
      workflowId,
      key,
      value,
      valueType,
      isSecret,
      description,
      tags,
      scope: rawScope,
      collection: rawCollection
    } = req.body || {};

    const scope = normalizeScope(rawScope, "workflow");
    const collection = normalizeCollection(rawCollection);

    if (!key) {
      return res.status(400).json({ error: "key is required" });
    }
    if (scope === "all") {
      return res.status(400).json({ error: "scope 'all' is not allowed for create" });
    }
    if (scope === "workflow") {
      if (!workflowId) {
        return res.status(400).json({ error: "workflowId is required for workflow scope" });
      }
      if (!(await ensureWorkflowOwnership(req, workflowId))) {
        return res.status(404).json({ error: "Workflow not found" });
      }
    }

    const doc = await WorkflowVariable.create({
      userId: req.user.id,
      workflowId: scope === "workflow" ? workflowId : null,
      scope,
      collection,
      key: String(key).trim(),
      value,
      valueType: valueType || detectValueType(value),
      isSecret: Boolean(isSecret),
      description: String(description || ""),
      tags: Array.isArray(tags) ? tags.map((t) => String(t)) : []
    });
    return res.status(201).json({ id: doc._id.toString() });
  } catch (err) {
    if (String(err?.message || "").includes("duplicate key") || err?.code === 11000) {
      return res.status(409).json({ error: "Key already exists in this scope/collection" });
    }
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { WorkflowVariable } = modelsOf(req);
    const doc = await WorkflowVariable.findOne({
      _id: req.params.id,
      userId: req.user.id
    }).lean();
    if (!doc) return res.status(404).json({ error: "Record not found" });
    return res.json(serializeItem(doc, { redact: false }));
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { WorkflowVariable } = modelsOf(req);
    const { value, valueType, isSecret, description, tags } = req.body || {};
    const update = {
      ...(value !== undefined ? { value } : {}),
      ...(valueType ? { valueType } : {}),
      ...(value !== undefined && !valueType ? { valueType: detectValueType(value) } : {}),
      ...(isSecret !== undefined ? { isSecret: Boolean(isSecret) } : {}),
      ...(description !== undefined ? { description: String(description || "") } : {}),
      ...(Array.isArray(tags) ? { tags: tags.map((t) => String(t)) } : {}),
      updatedAt: new Date()
    };
    const doc = await WorkflowVariable.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: update },
      { new: true }
    ).lean();
    if (!doc) return res.status(404).json({ error: "Record not found" });
    return res.json({ id: doc._id.toString() });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { WorkflowVariable } = modelsOf(req);
    const deleted = await WorkflowVariable.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id
    });
    if (!deleted) return res.status(404).json({ error: "Record not found" });
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

export default router;

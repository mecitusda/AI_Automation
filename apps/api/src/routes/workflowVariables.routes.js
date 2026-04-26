import express from "express";
import mongoose from "mongoose";
import { getPlatformModels } from "../utils/tenantModels.js";

const router = express.Router();

const modelsOf = () => getPlatformModels();

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
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "json";
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

router.get("/", async (req, res) => {
  try {
    const { WorkflowVariable } = modelsOf(req);
    const workflowId = String(req.query.workflowId || "");
    if (!workflowId) return res.status(400).json({ error: "workflowId is required" });
    if (!(await ensureWorkflowOwnership(req, workflowId))) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    const q = {
      userId: req.user.id,
      workflowId
    };
    const keyFilter = String(req.query.key || "").trim();
    const textFilter = String(req.query.q || "").trim();
    if (keyFilter) q.key = keyFilter;
    if (textFilter) {
      q.$or = [
        { key: { $regex: textFilter, $options: "i" } },
        { description: { $regex: textFilter, $options: "i" } }
      ];
    }

    const limit = parseLimit(req.query.limit, 50);
    const page = parsePage(req.query.page, 1);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      WorkflowVariable.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      WorkflowVariable.countDocuments(q)
    ]);

    return res.json({
      items: items.map((item) => ({
        id: item._id.toString(),
        workflowId: item.workflowId?.toString(),
        key: item.key,
        value: item.isSecret ? "[REDACTED]" : item.value,
        valueType: item.valueType,
        isSecret: item.isSecret,
        description: item.description || "",
        tags: item.tags || [],
        updatedAt: item.updatedAt,
        createdAt: item.createdAt
      })),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

router.post("/", async (req, res) => {
  try {
    const { WorkflowVariable } = modelsOf(req);
    const { workflowId, key, value, valueType, isSecret, description, tags } = req.body || {};
    if (!workflowId || !key) {
      return res.status(400).json({ error: "workflowId and key are required" });
    }
    if (!(await ensureWorkflowOwnership(req, workflowId))) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    const doc = await WorkflowVariable.create({
      userId: req.user.id,
      workflowId,
      key: String(key).trim(),
      value,
      valueType: valueType || detectValueType(value),
      isSecret: Boolean(isSecret),
      description: String(description || ""),
      tags: Array.isArray(tags) ? tags.map((t) => String(t)) : []
    });
    return res.status(201).json({ id: doc._id.toString() });
  } catch (err) {
    if (String(err?.message || "").includes("duplicate key")) {
      return res.status(409).json({ error: "Key already exists in workflow" });
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
    return res.json({
      id: doc._id.toString(),
      workflowId: doc.workflowId?.toString(),
      key: doc.key,
      value: doc.value,
      valueType: doc.valueType,
      isSecret: doc.isSecret,
      description: doc.description || "",
      tags: doc.tags || [],
      updatedAt: doc.updatedAt,
      createdAt: doc.createdAt
    });
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

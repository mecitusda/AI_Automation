import express from "express";
import mongoose from "mongoose";
import { getPlatformModels } from "../utils/tenantModels.js";

const router = express.Router();
const modelsOf = () => getPlatformModels();

router.get("/events", async (req, res) => {
  try {
    const { TelegramEvent } = modelsOf(req);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const q = { userId: req.user.id };

    if (req.query.runId && mongoose.isValidObjectId(req.query.runId)) {
      q.runId = req.query.runId;
    }
    if (req.query.workflowId && mongoose.isValidObjectId(req.query.workflowId)) {
      q.workflowId = req.query.workflowId;
    }
    if (req.query.direction) {
      q.direction = req.query.direction;
    }

    const rows = await TelegramEvent.find(q)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

export default router;

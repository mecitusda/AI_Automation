import express from "express";
import { Run } from "../models/run.model.js";
import { channel } from "../config/rabbit.js";
const router = express.Router();

router.get("/:id/summary", async (req, res) => {
  try {
    const run = await Run.findById(req.params.id);

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    res.json({
      id: run._id,
      status: run.status,
      currentStepIndex: run.currentStepIndex,
      finishedAt: run.finishedAt,
      stepStates: run.stepStates,
      logsCount: run.logs.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const run = await Run.findById(req.params.id);

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    res.json(run);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get("/", async (req, res) => {
  try {
    const runs = await Run.find()
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.post("/:id/cancel", async (req, res) => {
  try {
    const runId = req.params.id;

    await channel.publish(
      "automation.direct",
      "run.cancel",
      Buffer.from(JSON.stringify({
        runId,
        reason: req.body?.reason || ""
      }))
    );

    res.json({ message: "Cancel requested", runId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
export default router;
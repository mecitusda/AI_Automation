import express from "express";
import { redis } from "../config/redis.js";
import { Run } from "../models/run.model.js";

const router = express.Router();

const GLOBAL_MAX = Number(process.env.GLOBAL_MAX_INFLIGHT || 10);

function clampInt(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}



/**
 * GET /metrics/summary?windowSec=3600
 * Runs + Steps aggregation
 */
router.get("/summary", async (req, res) => {
  try {
    const windowSec = clampInt(req.query.windowSec, 60, 24 * 3600, 3600);
    const since = new Date(Date.now() - windowSec * 1000);

    const [agg] = await Run.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $facet: {
          runStatus: [
            { $group: { _id: "$status", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
  
          errorLogs: [
            { $unwind: { path: "$logs", preserveNullAndEmptyArrays: true } },
            { $match: { "logs.level": "error" } },
            { $group: { _id: null, errorCount: { $sum: 1 } } },
          ],
          retryLogs: [
            { $unwind: { path: "$logs", preserveNullAndEmptyArrays: true } },
            { $match: { "logs.level": "retry" } },
            { $group: { _id: null, retryLogCount: { $sum: 1 } } },
          ],
          timeoutHints: [
            { $unwind: { path: "$logs", preserveNullAndEmptyArrays: true } },
            {
              $match: {
                $or: [
                  { "logs.message": { $regex: "timeout", $options: "i" } },
                  { "logs.message": { $regex: "timed out", $options: "i" } },
                ],
              },
            },
            { $group: { _id: null, timeoutHintCount: { $sum: 1 } } },
          ],

          runDurations: [
            { $match: { status: { $in: ["completed", "failed"] }, durationMs: { $exists: true, $ne: null } } },
            { $group: { _id: "$status", avgDurationMs: { $avg: "$durationMs" }, p95ApproxMs: { $max: "$durationMs" }, count: { $sum: 1 } } },
          ],

          stepStatus: [
            { $unwind: { path: "$stepStates", preserveNullAndEmptyArrays: true } },
            { $match: { "stepStates.stepId": { $exists: true } } },
            {
              $group: {
                _id: { stepId: "$stepStates.stepId", status: "$stepStates.status" },
                count: { $sum: 1 },
                avgDurationMs: { $avg: "$stepStates.durationMs" },
                totalRetry: { $sum: "$stepStates.retryCount" },
                maxRetry: { $max: "$stepStates.retryCount" },
              },
            },
            { $sort: { count: -1 } },
          ],
        },
      },
    ]);

    const statusMap = (arr) =>
      Object.fromEntries((arr || []).map((x) => [x._id, x.count]));

    const durMap = (arr) =>
      Object.fromEntries(
        (arr || []).map((x) => [
          x._id,
          {
            avgDurationMs: x.avgDurationMs ?? null,
            maxDurationMs: x.p95ApproxMs ?? null,
          },
        ])
      );

    const runsByStatus = statusMap(agg?.runStatus);
    const runDurations = durMap(agg?.runDurations);

    const stepsByStatus = Object.fromEntries(
      (agg?.stepStatus || []).map((x) => [
        `${x._id?.stepId ?? x._id}:${x._id?.status ?? "unknown"}`,
        {
          count: x.count,
          avgDurationMs: x.avgDurationMs ?? null,
          totalRetry: x.totalRetry ?? 0,
          maxRetry: x.maxRetry ?? 0,
        },
      ])
    );

    const errorCount = agg?.errorLogs?.[0]?.errorCount ?? 0;
    const retryLogCount = agg?.retryLogs?.[0]?.retryLogCount ?? 0;
    const timeoutHintCount = agg?.timeoutHints?.[0]?.timeoutHintCount ?? 0;

    res.json({
      ok: true,
      ts: Date.now(),
      windowSec,
      since,
      runsByStatus,
      runDurations,
      stepsByStatus,
      logs: {
        errorCount,
        retryLogCount,
        timeoutHintCount,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

/**
 * GET /metrics/dashboard?windowSec=3600
 * Dashboard payload: avgRunDurationMs, stepFailureRate, activeRuns, runsPerWorkflow, stepExecutionCount
 */
router.get("/dashboard", async (req, res) => {
  try {
    const windowSec = clampInt(req.query.windowSec, 60, 24 * 3600, 3600);
    const since = new Date(Date.now() - windowSec * 1000);

    const [dashboard] = await Run.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $facet: {
          avgRunDuration: [
            { $match: { status: { $in: ["completed", "failed"] }, durationMs: { $exists: true, $ne: null } } },
            { $group: { _id: null, avgDurationMs: { $avg: "$durationMs" } } },
          ],
          activeRuns: [
            { $match: { status: "running" } },
            { $count: "count" },
          ],
          runsPerWorkflow: [
            { $group: { _id: "$workflowId", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          stepStats: [
            { $unwind: { path: "$stepStates", preserveNullAndEmptyArrays: true } },
            { $match: { "stepStates.stepId": { $exists: true } } },
            {
              $group: {
                _id: { stepId: "$stepStates.stepId", status: "$stepStates.status" },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]);

    const avgRunDurationMs = dashboard?.avgRunDuration?.[0]?.avgDurationMs ?? null;
    const activeRuns = dashboard?.activeRuns?.[0]?.count ?? 0;
    const runsPerWorkflow = (dashboard?.runsPerWorkflow || []).map((x) => ({
      workflowId: String(x._id),
      count: x.count,
    }));

    const stepStats = dashboard?.stepStats || [];
    let stepFailureRate = null;
    let stepExecutionCount = 0;
    const byStepId = {};
    for (const s of stepStats) {
      const stepId = s._id?.stepId ?? "unknown";
      const status = s._id?.status ?? "unknown";
      stepExecutionCount += s.count;
      if (!byStepId[stepId]) byStepId[stepId] = { failed: 0, completed: 0 };
      if (status === "failed") byStepId[stepId].failed += s.count;
      if (status === "completed") byStepId[stepId].completed += s.count;
    }
    const totals = Object.values(byStepId).reduce(
      (acc, v) => ({ failed: acc.failed + v.failed, completed: acc.completed + v.completed }),
      { failed: 0, completed: 0 }
    );
    if (totals.failed + totals.completed > 0) {
      stepFailureRate = totals.failed / (totals.failed + totals.completed);
    }

    res.json({
      ok: true,
      ts: Date.now(),
      windowSec,
      avgRunDurationMs,
      stepFailureRate,
      activeRuns,
      runsPerWorkflow,
      stepExecutionCount,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

export default router;
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
        x._id,
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

export default router;
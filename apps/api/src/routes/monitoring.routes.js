// apps/api/src/routes/monitoring.routes.js
import express from "express";
import { redis } from "../config/redis.js";
import { Run } from "../models/run.model.js";
import { channel } from "../config/rabbit.js";

const router = express.Router();

const INF_KEY = "global:inflight";
const TOK_SET = "global:tokens";
const READY_ZSET = "runs:ready";
const GLOBAL_MAX = Number(process.env.GLOBAL_MAX_INFLIGHT || 10);



router.get("/summary", async (_req, res) => {
  const now = Date.now();
  const thresholdMs = 30_000; // 15s: gerçek stuck için eşik (istersen 30s yap)

  const [infRaw, tokCount, readyIds, readyLen] = await Promise.all([
    redis.get(INF_KEY),
    redis.scard(TOK_SET),
    redis.zrange(READY_ZSET, 0, -1),
    redis.zcard(READY_ZSET),
  ]);

  const globalInflight = Number(infRaw || 0);
  const globalTokensCount = Number(tokCount || 0);
  const readyQueueLen = Number(readyLen || 0);

  const readySet = new Set(readyIds.map(String));

  // Son N running run'a bak (tam scan yerine limitli)
  const runningRuns = await Run.find({ status: "running" })
    .select({ createdAt: 1, stepStates: 1, logs: 1 })
    .sort({ createdAt: -1 })
    .limit(200);

  let stuckRuns = 0;

  for (const run of runningRuns) {
    const runId = run._id.toString();

    // READY_ZSET'te bekliyorsa stuck değildir (sağlıklı backpressure)
    if (readySet.has(runId)) continue;

    const ageMs = now - new Date(run.createdAt).getTime();
    if (ageMs < thresholdMs) continue;

    const stepStates = run.stepStates || [];
    if (!stepStates.length) continue;

    const hasRunning = stepStates.some(
      (s) => s.status === "running" || s.status === "retrying"
    );

    // cancelled/failed/completed zaten running filterinde yok ama güvenlik:
    if (hasRunning) continue;

    const allPending = stepStates.every((s) => s.status === "pending");
    if (!allPending) continue;

    // logs var/yok: burada iki seçenek var.
    // 1) "log yok" strict stuck: sadece totally silent stuck say
    // 2) "log olsa bile stuck": dispatch kuyruğuna düşmeden takılmışsa log basmış olabilir
    // Benim önerim: log'u şart koşma, çünkü enqueue log'u var.
    // Ama istersen extra alan olarak silentStuck sayabiliriz.
    stuckRuns += 1;
  }

  res.json({
    globalMax: GLOBAL_MAX,
    globalInflight,
    globalTokensCount,
    readyQueueLen,
    sanity: {
      inflightEqualsTokens: globalInflight === globalTokensCount,
      inflightOverMax: globalInflight > GLOBAL_MAX,
    },
    stuckRuns,
    ts: now,
  });
});
router.get("/stuck", async (req, res) => {
  const limit = Number(req.query.limit || 50);

  const thresholdMs = 15000; // 15 saniye
  const now = Date.now();

  const runs = await Run.find({
    status: "running"
  })
    .sort({ createdAt: -1 })
    .limit(limit);

  const stuck = runs.filter((run) => {
    const age = now - new Date(run.createdAt).getTime();

    if (age < thresholdMs) return false;

    const hasRunning = run.stepStates?.some(
      (s) => s.status === "running" || s.status === "retrying"
    );

    const allPending =
      run.stepStates?.length > 0 &&
      run.stepStates.every((s) => s.status === "pending");

    const noLogs = !run.logs || run.logs.length === 0;

    return !hasRunning && allPending && noLogs;
  });

  res.json({
    ok: true,
    count: stuck.length,
    data: stuck.map((r) => ({
      id: r._id,
      createdAt: r.createdAt,
      ageMs: now - new Date(r.createdAt).getTime(),
      stepCount: r.stepStates?.length ?? 0
    }))
  });
});

router.post("/stuck/:runId/heal", async (req, res) => {
  const { runId } = req.params;

  const run = await Run.findById(runId);
  if (!run) {
    return res.status(404).json({ ok: false, error: "Run not found" });
  }

  if (run.status !== "running") {
    return res.json({ ok: false, message: "Run not running" });
  }

  const hasRunning = run.stepStates?.some(
    (s) => s.status === "running" || s.status === "retrying"
  );

  const allPending =
    run.stepStates?.length > 0 &&
    run.stepStates.every((s) => s.status === "pending");

  if (hasRunning || !allPending) {
    return res.json({ ok: false, message: "Run not eligible for heal" });
  }

  // READY_ZSET'e tekrar koy
  await redis.zadd("runs:ready", Date.now(), runId);

  // kick publish
  await channel.publish(
    "automation.direct",
    "dispatch.kick",
    Buffer.from(JSON.stringify({ t: Date.now() }))
  );

  await Run.updateOne(
    { _id: runId },
    {
      $push: {
        logs: {
          stepId: "system",
          message: "Auto-heal: requeued to READY_ZSET",
          level: "system",
          createdAt: new Date()
        }
      }
    }
  );

  res.json({ ok: true });
});

export default router;
import { channel } from "./config/rabbit.js";
import { Run } from "./models/run.model.js";
import { Workflow } from "./models/workflow.model.js";
import { randomUUID } from "crypto";
import { resolveVariables } from "./utils/variableResolver.js";
import { evalCondition } from "./utils/condition.js";
import { redis } from "./config/redis.js";
import { publishStepExecution } from "./executionEngine.js";
import { movePendingToRunning, moveRetryingToRunning } from "./stateEngine.js";
const READY_ZSET = "runs:ready";
const GLOBAL_MAX = Number(process.env.GLOBAL_MAX_INFLIGHT || 10);
const INF_KEY = "global:inflight";     
const TOK_SET = "global:tokens";       
const TOK_TTL_MS = 10_000;             
const ACQUIRE_LUA = `
  local inf = KEYS[1]
  local setk = KEYS[2]
  local limit = tonumber(ARGV[1])
  local token = ARGV[2]
  local ttl = tonumber(ARGV[3])

  local cur = tonumber(redis.call("GET", inf) or "0")
  if cur >= limit then
    return 0
  end

  -- idempotency: token zaten varsa, tekrar sayma
  local added = redis.call("SADD", setk, token)
  if added == 1 then
    redis.call("INCR", inf)
    redis.call("PEXPIRE", inf, ttl)
  end

  redis.call("PEXPIRE", setk, ttl)
  return 1
`;


const RELEASE_LUA = `
  local inf = KEYS[1]
  local setk = KEYS[2]
  local token = ARGV[1]

  local removed = redis.call("SREM", setk, token)
  if removed == 1 then
    local cur = tonumber(redis.call("GET", inf) or "0")
    if cur > 0 then
      redis.call("DECR", inf)
    end
  end
  return removed
`;

async function enqueueReadyRun(runId) {
  // NX: zaten varsa tekrar ekleme
  await redis.zadd(READY_ZSET, "NX", Date.now(), runId);
}

async function dequeueReadyRun(runId) {
  await redis.zrem(READY_ZSET, runId);
}

async function acquireGlobalSlot({ runId, stepId, executionId }) {
  const token = `${runId}:${stepId}:${executionId}`;
  const ok = await redis.eval(ACQUIRE_LUA, 2, INF_KEY, TOK_SET, String(GLOBAL_MAX), token, String(TOK_TTL_MS));
  return ok === 1 ? token : null;
}

async function releaseGlobalSlot(token) {
  if (!token) return;
  const removed = await redis.eval(RELEASE_LUA, 2, INF_KEY, TOK_SET, token);

  // slot boşaldıysa (removed==1) bir kick gönder
  if (removed === 1) {
    await channel.publish(
      "automation.direct",
      "dispatch.kick",
      Buffer.from(JSON.stringify({ t: Date.now() }))
    );
  }
}





async function pumpReadyRuns({ io }) {
  const inf = Number(await redis.get(INF_KEY) || 0);
  const free = GLOBAL_MAX - inf;
  if (free <= 0) return;

  const batch = Math.min(free, 10);

  const runIds = await redis.zrange(READY_ZSET, 0, batch - 1);
  if (!runIds.length) return;

  for (const runId of runIds) {
    const run = await Run.findById(runId);
    if (!run || ["failed", "completed", "cancelled"].includes(run.status)) {
      await dequeueReadyRun(runId);
      continue;
    }

    // snapshot yoksa bu run dispatch edilemez → kuyruğu temizle
    // (istersen burada "recover snapshot" yazabiliriz ama sen net çözüm istedin)
    if (!run.workflowSnapshot || !run.workflowSnapshot.steps?.length) {
      await dequeueReadyRun(runId);
      continue;
    }

    await dispatchReadySteps({
      runId,
      channel,
      resolveVariables,
      io
    });

    const fresh = await Run.findById(runId);
    if (!fresh || ["failed", "completed", "cancelled"].includes(fresh.status)) {
      await dequeueReadyRun(runId);
      continue;
    }

    const hasPending = fresh.stepStates?.some(s => s.status === "pending");
    if (!hasPending) {
      await dequeueReadyRun(runId);
    }
  }
}

function emitRunUpdate(run, io) {
  if (!io) return;

  const payload = {
    id: run._id.toString(),
    status: run.status,
    currentStepIndex: run.currentStepIndex,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    stepStates: run.stepStates,
    logs: run.logs
  };

  // 🔹 Detail page için
  io.to(`run:${run._id}`).emit("run:update", payload);

  // 🔹 RunsPage için (GLOBAL)
  io.emit("runs:update", payload);
}

function emitRunLog(runId, log, io) {
  if (!io) return;
  io.to(`run:${runId}`).emit("run:log", log);
} 

async function addRunLog(runId, logEntry, io) {
  await Run.updateOne(
    { _id: runId },
    { $push: { logs: logEntry } }
  );

  // realtime
  emitRunLog(runId, logEntry, io);
}

function toPlain(stepDoc) {
  return typeof stepDoc?.toObject === "function" ? stepDoc.toObject() : stepDoc;
}

function getStepState(run, stepId) {
  let st = run.stepStates.find(s => s.stepId === stepId);
  if (!st) {
    st = { stepId, retryCount: 0, status: "pending" };
    run.stepStates.push(st);
  }
  return st;
}

function depsSatisfied(run, dependsOn = []) {
  if (!dependsOn?.length) return true;

  const stateById = new Map(run.stepStates.map(s => [s.stepId, s.status]));

  return dependsOn.every(depId => {
    const st = stateById.get(depId);
    return st === "completed" || st === "skipped";
  });
}

function buildPrevOutput(run, dependsOn = []) {
  if (!dependsOn?.length) return null;
  const obj = {};
  for (const depId of dependsOn) {
    obj[depId] = run.outputs?.[depId];
  }
  return obj;
}



async function handleIfStepDAG({ workflow, run, stepIndex, io }) {

  
  const step = workflow.steps[stepIndex];
  const stepId = step.id;

  const conditionExpr = step.params?.condition ?? "";
  const thenGoto = step.params?.thenGoto;
  const elseGoto = step.params?.elseGoto;

  const ok = evalCondition(conditionExpr, run.outputs);

  await addRunLog(
    run._id.toString(),
    {
      stepId,
      message: `IF evaluated: ${ok ? "THEN" : "ELSE"} (expr: ${conditionExpr})`,
      createdAt: new Date(),
      level: "system"
    },
    io
  );

  const rejected = ok ? elseGoto : thenGoto;


  // rejected branch'i skip et
  if (rejected) {
    await skipBranch(workflow, run._id.toString(), run, rejected, io);
  }

  const finishedAt = new Date();

  const res = await Run.updateOne(
    {
      _id: run._id,
      status: { $nin: ["failed", "completed", "cancelled"] },
      [`stepStates.${stepIndex}.status`]: "pending"
    },
    {
      $set: {
        [`stepStates.${stepIndex}.status`]: "completed",
        [`stepStates.${stepIndex}.finishedAt`]: finishedAt,
        [`outputs.${stepId}`]: { result: ok }
      }
    }
  );

  if (res.modifiedCount === 0) return;
  await addRunLog(
    run._id.toString(),
    {
      stepId,
      message: "Step completed",
      level: "info",
      createdAt: new Date()
    },
    io
  );
  const updatedRun = await Run.findById(run._id);
  emitRunUpdate(updatedRun, io);
}

async function dispatchReadySteps({
  runId,
  channel,
  resolveVariables,
  io
}) {
  const fresh = await Run.findById(runId);
  if (!fresh) return;
  if (["failed", "completed", "cancelled"].includes(fresh.status)) return;

  const run = fresh;
  const workflow = run.workflowSnapshot;

  if (!workflow || !workflow.steps?.length) return;

  const runningCount = run.stepStates.filter(s => s.status === "running").length;
  const maxParallel = workflow.maxParallel ?? 5;
  const availableSlots = maxParallel - runningCount;

  if (availableSlots <= 0) {
    await enqueueReadyRun(runId);
    return;
  }

  const readyIndexes = [];

  for (let i = 0; i < workflow.steps.length; i++) {
    const stepPlain = toPlain(workflow.steps[i]);
    const st = getStepState(run, stepPlain.id);

    if (st.status !== "pending") continue;

    if (stepPlain.type === "if") {
      if (depsSatisfied(run, stepPlain.dependsOn)) {
        await handleIfStepDAG({ workflow, run, stepIndex: i, io });
        return dispatchReadySteps({ runId, channel, resolveVariables, io });
      }
      continue;
    }

    if (depsSatisfied(run, stepPlain.dependsOn)) {
      readyIndexes.push(i);
    }
  }

  const limited = readyIndexes.slice(0, availableSlots);
  if (!limited.length) return;

  for (const idx of limited) {
    const stepPlain = toPlain(workflow.steps[idx]);
    const executionId = randomUUID();

    const globalToken = await acquireGlobalSlot({
      runId,
      stepId: stepPlain.id,
      executionId
    });

    if (!globalToken) continue;

    const moved = await movePendingToRunning({
      runId,
      stepIndex: idx,
      executionId
    });

    if (!moved) {
      await releaseGlobalSlot(globalToken);
      continue;
    }

    const previousOutput = buildPrevOutput(run, stepPlain.dependsOn);
    const resolvedParams = resolveVariables(stepPlain.params ?? {}, run.outputs);

    /* 🔹 START LOG FIRST (race fix) */
    await addRunLog(
      runId,
      {
        stepId: stepPlain.id,
        message: "Step started",
        createdAt: new Date(),
        level: "system"
      },
      io
    );

    /* 🔹 EXECUTION */
    try {
      await publishStepExecution({
        channel,
        stepPlain,
        runId,
        stepIndex: idx,
        executionId,
        resolvedParams,
        previousOutput,
        globalToken
      });
    } catch (err) {
      await releaseGlobalSlot(globalToken);
      throw err;
    }

    /* 🔹 TIMEOUT */
    if (stepPlain.timeout && stepPlain.timeout > 0) {
      await channel.sendToQueue(
        "step.timeout.q",
        Buffer.from(JSON.stringify({
          runId,
          stepIndex: idx,
          executionId,
          globalToken
        })),
        { expiration: String(stepPlain.timeout), persistent: true }
      );
    }
  }

  const updatedRun = await Run.findById(runId);
  emitRunUpdate(updatedRun, io);
}


function isRunDone(workflow, run) {
  const byId = new Map(run.stepStates.map(s => [s.stepId, s.status]));
  return workflow.steps.every((sdoc) => {
    const s = toPlain(sdoc);
    const st = byId.get(s.id);
    return ["completed", "skipped"].includes(st);
  });
}

async function skipBranch(workflow, runId, run, rootStepId, io) {

  const byId = new Map(run.stepStates.map(s => [s.stepId, s]));
  const skippedIds = [];

  function canStillRun(step) {
    return step.dependsOn.some(depId => {
      const depState = byId.get(depId)?.status;
      return depState !== "skipped" && depState !== "failed";
    });
  }

  function dfs(stepId) {
    const st = byId.get(stepId);
    if (!st || st.status !== "pending") return;

    skippedIds.push(stepId);
    st.status = "skipped"; // sadece DFS kontrol için (memory local)

    for (const step of workflow.steps) {
      if (step.dependsOn?.includes(stepId)) {

        if (canStillRun(step)) continue;

        dfs(step.id);
      }
    }
  }

  dfs(rootStepId);

  if (!skippedIds.length) return;

  await Run.updateOne(
    { _id: runId },
    {
      $set: {
        "stepStates.$[s].status": "skipped"
      }
    },
    {
      arrayFilters: [
        { "s.stepId": { $in: skippedIds }, "s.status": "pending" }
      ]
    }
  );
  await Promise.all(
    skippedIds.map((sid) =>
      addRunLog(
        runId,
        { stepId: sid, message: "Step skipped (branch not selected)", createdAt: new Date(), level: "system" },
        io
      )
    )
  );
}


async function propagateRunFailure({ runId, failedStepId, io }) {

  const res1 = await Run.updateOne(
    { _id: runId },
    { $set: { "stepStates.$[s].status": "cancelled" } },
    { arrayFilters: [{ "s.status": { $in: ["running", "retrying"] } }] }
  );

  const res2 = await Run.updateOne(
    { _id: runId },
    { $set: { "stepStates.$[s].status": "skipped" } },
    { arrayFilters: [{ "s.status": "pending" }] }
  );

  const somethingChanged =
    res1.modifiedCount > 0 || res2.modifiedCount > 0;

  if (somethingChanged) {

    const runDoc = await Run.findById(runId);

    const cancelledSteps = runDoc?.stepStates?.filter(
      s => s.status === "cancelled"
    ) || [];

    await Promise.all(
      cancelledSteps.map(st =>
        addRunLog(
          runId,
          {
            stepId: st.stepId,
            message: "Step cancelled due to run failure",
            level: "system",
            createdAt: new Date()
          },
          io
        )
      )
    );

    await addRunLog(
      runId,
      {
        stepId: "system",
        level: "error",
        message: `Run failed -> cancelled running steps, skipped pending steps (failedStep=${failedStepId})`,
        createdAt: new Date()
      },
      io
    );

    const updated = await Run.findById(runId);

    if (updated) {
      await cancelExecutions(updated, "Run failed");
      emitRunUpdate(updated, io);
    }
  }

  return {
    cancelledRunning: res1.modifiedCount,
    skippedPending: res2.modifiedCount
  };
}

async function cancelExecutions(run, reason = "Run cancelled") {

  const executionIds = run.stepStates
    .filter(s =>
      ["running", "retrying"].includes(s.status) && s.executionId
    )
    .map(s => s.executionId);

  await Promise.all(
    executionIds.map(executionId =>
      channel.publish(
        "automation.direct",
        "step.cancel",
        Buffer.from(JSON.stringify({
          executionId,
          reason
        }))
      )
    )
  );
}
export async function startOrchestrator({ io }) {

  /* ================= RUN START ================= */

  await channel.consume("run.start.q", async (msg) => {
  if (!msg) return;

  try {
    const { runId } = JSON.parse(msg.content.toString());

    const run = await Run.findById(runId);
    if (!run) return channel.ack(msg);

    // Idempotent guard
    if (run.status !== "queued") {
      return channel.ack(msg);
    }

    if (run.status === "cancelled") {
      emitRunUpdate(run, io);
      return channel.ack(msg);
    }

    /* ================= LOAD WORKFLOW ================= */

    const workflowDoc = await Workflow.findById(run.workflowId);

    if (!workflowDoc) {
      const finishedAt = new Date();

      await Run.updateOne(
        { _id: runId },
        {
          $set: {
            status: "failed",
            finishedAt,
            durationMs: finishedAt.getTime() - run.createdAt.getTime()
          }
        }
      );

      await dequeueReadyRun(runId);

      const finalRun = await Run.findById(runId);
      emitRunUpdate(finalRun, io);

      return channel.ack(msg);
    }

    /* ================= SNAPSHOT RESOLUTION ================= */

    // Version varsa versions içinden al
    const version = workflowDoc.versions?.find(
      v => v.version === run.workflowVersion
    );

    const snapshot = version
      ? {
          steps: version.steps,
          maxParallel: version.maxParallel ?? workflowDoc.maxParallel ?? 5,
          version: run.workflowVersion
        }
      : {
          steps: workflowDoc.steps,
          maxParallel: workflowDoc.maxParallel ?? 5,
          version: run.workflowVersion
        };

    if (!snapshot.steps?.length) {
      const finishedAt = new Date();

      await Run.updateOne(
        { _id: runId },
        {
          $set: {
            status: "failed",
            finishedAt,
            durationMs: finishedAt.getTime() - run.createdAt.getTime()
          }
        }
      );

      await dequeueReadyRun(runId);

      const finalRun = await Run.findById(runId);
      emitRunUpdate(finalRun, io);

      return channel.ack(msg);
    }

    /* ================= INIT RUN WITH SNAPSHOT ================= */

    await Run.updateOne(
      { _id: runId },
      {
        $set: {
          status: "running",
          currentStepIndex: 0,
          processedMessages: [],
          outputs: {},
          workflowSnapshot: snapshot,
          stepStates: snapshot.steps.map(step => ({
            stepId: step.id,
            retryCount: 0,
            status: "pending"
          }))
        }
      }
    );

    const updatedRun = await Run.findById(runId);
    emitRunUpdate(updatedRun, io);

    /* ================= DISPATCH ================= */

    // Eğer bu arada cancel olmuşsa çık
    if (updatedRun.status === "cancelled") {
      return channel.ack(msg);
    }

    await dispatchReadySteps({
      runId,
      channel,
      resolveVariables,
      io
    });

    return channel.ack(msg);

  } catch (err) {
    console.error("RUN START ERROR:", err);
    channel.nack(msg, false, true);
  }
});


  /* ================= STEP RESULT ================= */

  await channel.consume("step.result.q", async (msg) => {
  if (!msg) return;

  try {
    const payload = JSON.parse(msg.content.toString());
    const {
      executionId,
      runId,
      stepIndex,
      success,
      output,
      error,
      globalToken
    } = payload;

    const run = await Run.findById(runId);
    if (!run) {
      await dequeueReadyRun(runId);
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    if (["failed", "completed", "cancelled"].includes(run.status)) {
      await dequeueReadyRun(runId);
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    /* ===== IDEMPOTENCY ===== */
    const idem = await Run.updateOne(
      { _id: runId, processedMessages: { $ne: executionId } },
      { $addToSet: { processedMessages: executionId } }
    );

    if (idem.modifiedCount === 0) {
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    const workflow = run.workflowSnapshot;
    if (!workflow) {
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    const step = workflow.steps[stepIndex];
    if (!step) {
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    const stepId = step.id;

    let stepState = run.stepStates.find((s) => s.stepId === stepId);
    if (!stepState) {
      stepState = { stepId, retryCount: 0, status: "pending" };
      run.stepStates.push(stepState);
    }

    /* ================= SUCCESS ================= */
       if (success) {
        
     const logEntry = {
       stepId,
       message: "Step completed",
       createdAt: new Date(),
       level: "info"
     };
   
     const finishedAt = new Date();
   
     const freshRun = await Run.findById(runId);
     const startedAt = freshRun?.stepStates?.[stepIndex]?.startedAt;
   
     const durationMs = startedAt
       ? finishedAt.getTime() - new Date(startedAt).getTime()
       : null;
   
     const res = await Run.updateOne(
       {
         _id: runId,
         status: { $nin: ["failed", "completed", "cancelled"] },
         [`stepStates.${stepIndex}.status`]: "running",
        [`stepStates.${stepIndex}.executionId`]: executionId
       },
       {
         $push: { logs: logEntry },
         $set: {
           [`stepStates.${stepIndex}.status`]: "completed",
           [`stepStates.${stepIndex}.finishedAt`]: finishedAt,
           [`stepStates.${stepIndex}.durationMs`]: durationMs,
           [`outputs.${stepId}`]: output
         }
       }
     );
   
     if (res.modifiedCount === 0) {
       await releaseGlobalSlot(globalToken);
       return channel.ack(msg);
     }
   
     emitRunLog(runId, logEntry, io);
   
     const updatedRun = await Run.findById(runId);
     emitRunUpdate(updatedRun, io);
   
     await releaseGlobalSlot(globalToken);
   
     if (["failed", "completed", "cancelled"].includes(updatedRun.status)) {
       return channel.ack(msg);
     }
   
     /* 🔹 DISPATCH NEXT STEPS */
   
     await dispatchReadySteps({
       runId,
       channel,
       resolveVariables,
       io
     });
   
     /* 🔹 RUN COMPLETION CHECK */
   
     const refreshed = await Run.findById(runId);
   
     if (refreshed.status !== "running") {
       return channel.ack(msg);
     }
   
     const wf = refreshed.workflowSnapshot;
   
     if (wf && isRunDone(wf, refreshed)) {
      
       const doneAt = new Date();
      
       const completeRes = await Run.updateOne(
      { _id: runId, status: "running" },
      {
        $set: {
          status: "completed",
          finishedAt: doneAt,
          durationMs: doneAt.getTime() - refreshed.createdAt.getTime()
        }
      }
       );
     
       if (completeRes.modifiedCount === 0) {
         return channel.ack(msg);
       }
     
       await dequeueReadyRun(runId);
     
       const finalRun = await Run.findById(runId);
     
       emitRunUpdate(finalRun, io);
     
       await addRunLog(
         runId,
         {
           stepId: "system",
           message: "Run completed successfully",
           createdAt: new Date(),
           level: "info"
         },
         io
       );
     }
   
     return channel.ack(msg);
    }

    /* ================= FAILURE ================= */

    const maxRetry =
      typeof step.retry === "number" ? step.retry : step.retry?.max ?? 0;

    const nextRetry = (stepState.retryCount ?? 0) + 1;

    const isTimeout =
      typeof error === "string" && error.toLowerCase().includes("timeout");

    /* ========== RETRY PATH ========== */
    if (nextRetry <= maxRetry) {
      // Timeout failure log'u timeout consumer zaten basıyor olabilir.
      // Timeout değilse burada "Step failed" log bas.
      if (!isTimeout) {
        await addRunLog(
          runId,
          {
            stepId,
            message: `Step failed: ${error}`,
            createdAt: new Date(),
            level: "error"
          },
          io
        );
      }

      const res = await Run.updateOne(
        {
          _id: runId,
          status: { $nin: ["failed", "completed", "cancelled"] },
          [`stepStates.${stepIndex}.status`]: "running",
          [`stepStates.${stepIndex}.executionId`]: executionId
        },
        {
          $set: {
            [`stepStates.${stepIndex}.retryCount`]: nextRetry,
            [`stepStates.${stepIndex}.status`]: "retrying"
          }
        }
      );

      // stale result guard
      if (res.modifiedCount === 0) {
        await releaseGlobalSlot(globalToken);
        return channel.ack(msg);
      }

      const updatedRun = await Run.findById(runId);
      emitRunUpdate(updatedRun, io);

      const delayMs = 2000 * Math.pow(2, nextRetry - 1);

      await addRunLog(
        runId,
        {
          stepId,
          message: `Retry scheduled in ${delayMs}ms (attempt ${nextRetry}/${maxRetry})`,
          createdAt: new Date(),
          level: "retry"
        },
        io
      );

      await releaseGlobalSlot(globalToken);

      channel.sendToQueue(
        "step.retry.q",
        Buffer.from(
          JSON.stringify({
            runId,
            stepIndex,
            retryCount: nextRetry,
            timerId: randomUUID()
          })
        ),
        {
          expiration: String(delayMs),
          persistent: true
        }
      );

      return channel.ack(msg);
    }

    /* ========== FINAL FAIL PATH (retry bitti) ========== */

    const finishedAt = new Date();
    const freshRun = await Run.findById(runId);
    const startedAt = freshRun?.stepStates?.[stepIndex]?.startedAt;
    const durationMs = startedAt
      ? finishedAt.getTime() - new Date(startedAt).getTime()
      : null;

    // Timeout ise "Step failed" logunu timeout consumer basıyor olabilir.
    // Burada sadece timeout DEĞİLSE step fail log basıyoruz.
    const stepFailLog = !isTimeout
      ? {
          stepId,
          message: `Step failed: ${error}`,
          createdAt: new Date(),
          level: "error"
        }
      : null;

    // DB update: stepFailLog null ise logs push yapma!
    const update = {
      $set: {
        status: "failed",
        finishedAt,
        durationMs: finishedAt.getTime() - run.createdAt.getTime(),
        [`stepStates.${stepIndex}.status`]: "failed",
        [`stepStates.${stepIndex}.finishedAt`]: finishedAt,
        [`stepStates.${stepIndex}.durationMs`]: durationMs
      }
    };

    if (stepFailLog) {
      update.$push = { logs: stepFailLog };
    }

    const res = await Run.updateOne(
      {
        _id: runId,
        status: { $nin: ["completed", "failed", "cancelled"] },
        [`stepStates.${stepIndex}.status`]: { $in: ["running", "retrying"]},
        [`stepStates.${stepIndex}.executionId`]: executionId
         
      },
      update
    );

    if (res.modifiedCount === 0) {
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    await dequeueReadyRun(runId);

    // realtime step fail log (tek kez!)
    if (stepFailLog) {
      emitRunLog(runId, stepFailLog, io);
    }

    await addRunLog(
      runId,
      {
        stepId: "system",
        message: "Run failed",
        createdAt: new Date(),
        level: "error"
      },
      io
    );

    await propagateRunFailure({ runId, failedStepId: stepId, io });

    await releaseGlobalSlot(globalToken);

    return channel.ack(msg);
  } catch (err) {
    console.error("STEP RESULT ERROR:", err);
    channel.nack(msg, false, true);
  }
});
  
 await channel.consume("run.cancel.q", async (msg) => {
  if (!msg) return;

  try {
    const { runId, reason } = JSON.parse(msg.content.toString());

    const run = await Run.findById(runId);
    if (!run) {
      channel.ack(msg);
      return;
    }

    // idempotent guard
    if (["completed", "failed", "cancelled"].includes(run.status)) {
      channel.ack(msg);
      return;
    }

    const finishedAt = new Date();

    const systemLog = {
      stepId: "system",
      message: `Run cancelled${reason ? `: ${reason}` : ""}`,
      createdAt: new Date(),
      level: "error"
    };

    /* ================= RUN STATUS ================= */

    await Run.updateOne(
      { _id: runId },
      {
        $set: { status: "cancelled", finishedAt },
        $push: { logs: systemLog }
      }
    );

    /* ================= STEP STATE UPDATE ================= */

    await Run.updateOne(
      { _id: runId },
      {
        $set: {
          "stepStates.$[r].status": "cancelled",
          "stepStates.$[p].status": "skipped"
        }
      },
      {
        arrayFilters: [
          { "r.status": { $in: ["running", "retrying"] } },
          { "p.status": "pending" }
        ]
      }
    );

    /* ================= READY QUEUE CLEAN ================= */

    await dequeueReadyRun(runId);

    /* ================= REFRESH RUN ================= */

    const finalRun = await Run.findById(runId);

    if (!finalRun) {
      channel.ack(msg);
      return;
    }

    /* ================= STEP LOG GENERATION ================= */

    const stepLogs = [];

    for (const s of finalRun.stepStates) {

      if (s.status === "cancelled") {
        stepLogs.push({
          stepId: s.stepId,
          message: "Step cancelled",
          level: "system",
          createdAt: new Date()
        });
      }

      if (s.status === "skipped") {
        stepLogs.push({
          stepId: s.stepId,
          message: "Step skipped (run cancelled)",
          level: "system",
          createdAt: new Date()
        });
      }
    }

    if (stepLogs.length) {
      await Run.updateOne(
        { _id: runId },
        { $push: { logs: { $each: stepLogs } } }
      );
    }

    /* ================= WORKER CANCEL ================= */

    await cancelExecutions(finalRun, "Run cancelled");

    /* ================= WEBSOCKET EVENTS ================= */

    emitRunUpdate(finalRun, io);
    emitRunLog(runId, systemLog, io);

    for (const log of stepLogs) {
      emitRunLog(runId, log, io);
    }

    channel.ack(msg);

  } catch (err) {
    console.error("RUN CANCEL ERROR:", err);
    channel.nack(msg, false, true);
  }
});

 await channel.consume("step.retry.fire.q", async (msg) => {
  if (!msg) return;

  try {
    const { runId, stepIndex, retryCount } = JSON.parse(msg.content.toString());

    const run = await Run.findById(runId);
    if (!run) return channel.ack(msg);
    if (["failed","completed","cancelled"].includes(run.status)) return channel.ack(msg);

    const workflow = run.workflowSnapshot;
    if (!workflow) return channel.ack(msg);

    const stepPlain = toPlain(workflow.steps[stepIndex]);
    if (!stepPlain) return channel.ack(msg);

    const executionId = randomUUID();

    // 1️⃣ SLOT
    const globalToken = await acquireGlobalSlot({
      runId,
      stepId: stepPlain.id,
      executionId
    });

    if (!globalToken) {
      await enqueueReadyRun(runId);
      return channel.ack(msg);
    }

    // 2️⃣ STATE
    const moved = await moveRetryingToRunning({
      runId,
      stepIndex,
      retryCount,
      executionId
    });

    if (!moved) {
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    
    emitRunUpdate(run, io);

    const previousOutput = buildPrevOutput(run, stepPlain.dependsOn);
    const resolvedParams = resolveVariables(stepPlain.params ?? {}, run.outputs);

    await addRunLog(
      runId,
      {
        stepId: stepPlain.id,
        message: `Retry attempt ${retryCount}/${stepPlain.retry} started`,
        level: "retry",
        createdAt: new Date()
      },
      io
    );
    // 3️⃣ EXECUTE
    try {
      await publishStepExecution({
        channel,
        stepPlain,
        runId,
        stepIndex,
        executionId,
        resolvedParams,
        previousOutput,
        globalToken
      });
    } catch (err) {
      await releaseGlobalSlot(globalToken);
      throw err;
    }

    if (stepPlain.timeout && stepPlain.timeout > 0) {
      await channel.sendToQueue(
        "step.timeout.q",
        Buffer.from(JSON.stringify({
          runId,
          stepIndex,
          executionId,
          globalToken
        })),
        { expiration: String(stepPlain.timeout), persistent: true }
      );
    }

    return channel.ack(msg);

  } catch (err) {
    console.error("RETRY FIRE ERROR:", err);
    channel.nack(msg, false, true);
  }
});

 
  await channel.consume("step.timeout.fire.q", async (msg) => {
    if (!msg) return;

    try {
    const { runId, stepIndex, executionId, globalToken } =
    JSON.parse(msg.content.toString());
    console.log("TIMEOUT FIRE:", { runId, stepIndex, executionId });
    
    const run = await Run.findById(runId);
    if (!run) {
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    if (["failed", "completed", "cancelled"].includes(run.status)) {
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    const workflow = run.workflowSnapshot;
    const step = workflow?.steps?.[stepIndex];
    const stepState = run.stepStates?.[stepIndex];

    if (!step || !stepState) {
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }
    if (stepState.status !== "running") {
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    // stale timeout guard
    if (stepState.executionId !== executionId) {
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    /* ================= WORKER CANCEL ================= */

    await channel.sendToQueue(
      "step.cancel.q",
      Buffer.from(
        JSON.stringify({
          executionId,
          reason: "Step timeout"
        })
      )
    );

    const maxRetry = typeof step.retry === "number"
  ? step.retry
  : step.retry?.max ?? 0;
    const nextRetry = (stepState.retryCount ?? 0) + 1;

    /* ================= RETRY VAR ================= */

    if (nextRetry <= maxRetry) {
    
      const res = await Run.updateOne(
        {
          _id: runId,
          [`stepStates.${stepIndex}.status`]: "running"
        },
        {
          $set: {
            [`stepStates.${stepIndex}.status`]: "retrying",
            [`stepStates.${stepIndex}.retryCount`]: nextRetry
          }
        }
      );
    
      if (res.modifiedCount === 0) {
        await releaseGlobalSlot(globalToken);
        return channel.ack(msg);
      }
      await addRunLog(
        runId,
        {
          stepId: step.id,
          message: "Step failed: Timeout exceeded",
          level: "error",
          createdAt: new Date()
        },
        io
      );
      const delayMs = 2000 * Math.pow(2, nextRetry - 1);
    
      await addRunLog(
        runId,
        {
          stepId: step.id,
          message: `Retry scheduled in ${delayMs}ms (attempt ${nextRetry}/${maxRetry})`,
          level: "retry",
          createdAt: new Date()
        },
        io
      );
    
      await releaseGlobalSlot(globalToken);
    
      await channel.sendToQueue(
        "step.retry.q",
        Buffer.from(
          JSON.stringify({
            runId,
            stepIndex,
            retryCount: nextRetry
          })
        ),
        {
          expiration: String(delayMs),
          persistent: true
        }
      );
    
      return channel.ack(msg);
    }

    /* ================= RETRY BİTTİ ================= */

    const finishedAt = new Date();

    await Run.updateOne(
      { _id: runId,
        [`stepStates.${stepIndex}.executionId`]: executionId
      },
      {
        $set: {
          [`stepStates.${stepIndex}.status`]: "failed",
          [`stepStates.${stepIndex}.finishedAt`]: finishedAt
        }
      }
    );

    await addRunLog(
      runId,
      {
        stepId: step.id,
        message: "Step failed: Timeout exceeded",
        level: "error",
        createdAt: new Date()
      },
      io
    );

    /* ================= RUN FAIL ================= */

    await Run.updateOne(
      { _id: runId, status: "running" },
      {
        $set: {
          status: "failed",
          finishedAt,
          durationMs: finishedAt.getTime() - run.createdAt.getTime()
        }
      }
    );

    await addRunLog(
      runId,
      {
        stepId: "system",
        message: `Run failed (step=${step.id})`,
        level: "error",
        createdAt: new Date()
      },
      io
    );

    await dequeueReadyRun(runId);
    await releaseGlobalSlot(globalToken);

    const finalRun = await Run.findById(runId);
    if (finalRun) emitRunUpdate(finalRun, io);

    await propagateRunFailure({
      runId,
      failedStepId: step.id,
      io
    });

    return channel.ack(msg);


    } catch (err) {
    console.error("TIMEOUT HANDLER ERROR:", err);
    channel.nack(msg, false, true);
    }
  });



  await channel.consume("dispatch.kick.q", async (msg) => {
    if (!msg) return;
    try {
      await pumpReadyRuns({ io });
      channel.ack(msg);
    } catch (e) {
      console.error("DISPATCH KICK ERROR:", e);
      channel.nack(msg, false, true);
    }
  });

  await channel.consume("workflow.created.q", async (msg) => {
    if (!msg) return;

    try {
      const { workflowId } = JSON.parse(msg.content.toString());

      const workflow = await Workflow.findById(workflowId);
      if (!workflow) return channel.ack(msg);

      io.emit("workflow:create", {
        id: workflow._id.toString(),
        name: workflow.name,
        enabled: workflow.enabled,
        currentVersion: workflow.currentVersion,
        stepCount: workflow.steps.length,
        trigger: workflow.trigger?.type
      });

      channel.ack(msg);
    } catch (err) {
      console.error("WORKFLOW CREATED EVENT ERROR:", err);
      channel.nack(msg, false, true);
    }
  });
  setInterval(() => {
    pumpReadyRuns({ io }).catch((e) => console.error("PUMP TICK ERROR:", e));
  }, 1000);
  console.log("Orchestrator running (enterprise mode)...");
}
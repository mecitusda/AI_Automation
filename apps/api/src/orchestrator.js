import { channel } from "./config/rabbit.js";
import { Run } from "./models/run.model.js";
import { Workflow } from "./models/workflow.model.js";
import { randomUUID } from "crypto";
import { resolveVariables } from "./utils/variableResolver.js";
import { evalCondition } from "./utils/condition.js";





function emitRunUpdate(run, io) {
  if (!io) return;

  const payload = {
    id: run._id.toString(),
    status: run.status,
    currentStepIndex: run.currentStepIndex,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    stepStates: run.stepStates
  };

  // 🔹 Detail page için
  io.to(`run:${run._id}`).emit("run:update", payload);

  // 🔹 RunsPage için (GLOBAL)
  io.emit("run:update", payload);
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
    obj[depId] = run.outputs?.get(depId);
  }
  return obj;
}

async function dispatchStep({ workflow, run, runId, stepIndex, channel, resolveVariables }) {
  const stepDoc = workflow.steps[stepIndex];
  if (!stepDoc) throw new Error(`dispatchStep: step not found at index ${stepIndex}`);

  const stepPlain = toPlain(stepDoc);
  if (!stepPlain.type) throw new Error(`dispatchStep: step.type missing for stepId=${stepPlain.id} index=${stepIndex}`);

  // DAG: step’in dependsOn çıktılarından “previousOutput” üret
  const previousOutput = buildPrevOutput(run, stepPlain.dependsOn);

  const resolvedParams = resolveVariables(stepPlain.params ?? {}, run.outputs);

  await channel.publish(
    "automation.direct",
    "step.execute",
    Buffer.from(JSON.stringify({
      executionId: randomUUID(),
      runId,
      stepIndex,
      step: { ...stepPlain, params: resolvedParams },
      previousOutput
    }))
  );
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

  await Run.updateOne(
    { _id: run._id },
    {
      $set: {
        [`stepStates.${stepIndex}.status`]: "completed",
        [`outputs.${stepId}`]: { result: ok }
      }
    }
  );
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
async function dispatchReadySteps({ workflow, run, runId, channel, resolveVariables, io }) {

  const fresh = await Run.findById(runId);
  if (!fresh || fresh.status === "cancelled") return;
  run = fresh;

  const runningCount = run.stepStates.filter(
    s => s.status === "running"
  ).length;

  const maxParallel = workflow.maxParallel ?? 5;
  const availableSlots = maxParallel - runningCount;

  if (availableSlots <= 0) return;

  const readyIndexes = [];

  for (let i = 0; i < workflow.steps.length; i++) {

    const stepPlain = toPlain(workflow.steps[i]);
    const st = getStepState(run, stepPlain.id);

    if (st.status !== "pending") continue;
    if (stepPlain.type === "if") {
      if (depsSatisfied(run, stepPlain.dependsOn)) {
        await handleIfStepDAG({ workflow, run, stepIndex: i, io });
        const refreshed = await Run.findById(runId);
        return dispatchReadySteps({ workflow, run: refreshed, runId, channel, resolveVariables, io });
      }
      continue
    }
    if (depsSatisfied(run, stepPlain.dependsOn)) {
      readyIndexes.push(i);
    }
  }

  const limitedIndexes = readyIndexes.slice(0, availableSlots);

  if (!limitedIndexes.length) return;
  
  const stepIds = limitedIndexes.map(i => toPlain(workflow.steps[i]).id);
   await Run.updateOne(
      { _id: runId },
      {
        $set: {
          "stepStates.$[s].status": "running",
          "stepStates.$[s].startedAt": new Date()
        }
      },
      {
        arrayFilters: [
          { "s.stepId": { $in: stepIds }, "s.status": "pending" }
        ]
      }
    );
  const updatedRun = await Run.findById(runId);
  emitRunUpdate(updatedRun, io);
  await Promise.all(
  stepIds.map((stepId) =>
      addRunLog(
        runId,
        { stepId, message: "Step started", createdAt: new Date(), level: "system" },
        io
      )
    )
  );

  await Promise.all(
    limitedIndexes.map((idx) =>
      dispatchStep({ workflow, run: updatedRun, runId, stepIndex: idx, channel, resolveVariables })
    )
  );
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

async function markStepRunningIfRetrying({ runId, stepIndex, retryCount, io }) {
  // retry.fire duplicate gelirse aynı step'i iki kez çalıştırma
  const res = await Run.updateOne(
    {
      _id: runId,
      [`stepStates.${stepIndex}.status`]: "retrying",
      [`stepStates.${stepIndex}.retryCount`]: retryCount
    },
    {
      $set: {
        [`stepStates.${stepIndex}.status`]: "running",
        [`stepStates.${stepIndex}.startedAt`]: new Date()
      }
    }
  );

  if (res.modifiedCount > 0) {
    const updated = await Run.findById(runId);
    emitRunUpdate(updated, io);
    return updated;
  }

  return null;
}

export async function startOrchestrator({ io }) {

  /* ================= RUN START ================= */

  await channel.consume("run.start.q", async (msg) => {
  if (!msg) return;

  try {
    const { runId } = JSON.parse(msg.content.toString());

    const run = await Run.findById(runId);
    if (!run) return channel.ack(msg);

    // 🛑 Cancel guard
    if (run.status === "cancelled") {
      emitRunUpdate(run, io);
      return channel.ack(msg);
    }

    const workflow = await Workflow.findById(run.workflowId);
    if (!workflow) {
      const finishedAt = new Date();

      await Run.updateOne(
        { _id: runId },
        { $set: { status: "failed", finishedAt, durationMs: finishedAt.getTime() - run.createdAt.getTime() } }
      );
    
      const finalRun = await Run.findById(runId);
      emitRunUpdate(finalRun, io);
      return channel.ack(msg);
    }

    /* ================= INIT RUN ================= */

    await Run.updateOne(
      { _id: runId },
      {
        $set: {
          status: "running",
          currentStepIndex: 0,
          processedMessages: [],
          outputs: {},
          stepStates: workflow.steps.map(step => ({
            stepId: step.id,
            retryCount: 0,
            status: "pending"
          }))
        }
      }
    );
    const updatedRun = await Run.findById(runId);
    emitRunUpdate(updatedRun, io);
   
    /* ================= DISPATCH READY STEPS (DAG) ================= */

    // Cancel tekrar kontrol
    if (updatedRun.status === "cancelled") {
      return channel.ack(msg);
    }

    await dispatchReadySteps({
      workflow,
      run: updatedRun,
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
      error
    } = payload;

    const run = await Run.findById(runId);
    if (!run) return channel.ack(msg);
    if (run.status === "cancelled") {
      return channel.ack(msg);
    }
    /* ===== IDEMPOTENCY ===== */

    const idem = await Run.updateOne(
      { _id: runId, processedMessages: { $ne: executionId } },
      { $addToSet: { processedMessages: executionId } }
    );
    if (idem.modifiedCount === 0) {
      return channel.ack(msg); // duplicate
    }

    const workflow = await Workflow.findById(run.workflowId);
    if (!workflow) {

    const finishedAt = new Date();

    const logEntry = {
      stepId: "system",
      message: "Workflow definition not found during execution",
      createdAt: new Date()
    };

    await Run.updateOne(
      { _id: runId },
      {
        $set: {
          status: "failed",
          finishedAt,
          durationMs: finishedAt.getTime() - run.createdAt.getTime()
        },
        $push: {
          logs: logEntry
        }
      }
    );

    const finalRun = await Run.findById(runId);

    emitRunUpdate(finalRun, io);
    emitRunLog(runId, logEntry, io);

    return channel.ack(msg);
  }

    const step = workflow.steps[stepIndex];
    if (!step) return channel.ack(msg);

    const stepId = step.id;

    let stepState = run.stepStates.find(s => s.stepId === stepId);
    if (!stepState) {
      stepState = { stepId, retryCount: 0, status: "pending" };
      run.stepStates.push(stepState);
    }

    /* ================= SUCCESS ================= */

    if (success) {
  const logEntry = {
    stepId,
    message: "Step completed",
    createdAt: new Date()
  };

  const finishedAt = new Date();
  const freshRun = await Run.findById(runId);
  const startedAt = freshRun.stepStates[stepIndex].startedAt;
  const durationMs = startedAt ? (finishedAt - startedAt) : null;
  await Run.updateOne(
    { _id: runId },
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

  emitRunLog(runId, logEntry, io);

  const updatedRun = await Run.findById(runId);
  emitRunUpdate(updatedRun, io);

  if (updatedRun.status === "cancelled") {
    return channel.ack(msg);
  }

  // yeni step’leri çalıştır
  await dispatchReadySteps({
    workflow,
    run: updatedRun,
    runId,
    channel,
    resolveVariables,
    io
  });

  //  RUN COMPLETED kontrolü
  const refreshed = await Run.findById(runId);

  if (isRunDone(workflow, refreshed)) {
    const finishedAt = new Date();

    await Run.updateOne(
      { _id: runId },
      {
        $set: {
          status: "completed",
          finishedAt,
          durationMs: finishedAt.getTime() - refreshed.createdAt.getTime()
        }
      }
    );

    const finalRun = await Run.findById(runId);
    emitRunUpdate(finalRun, io);

    await addRunLog(runId, {
      stepId: "system",
      message: "Run completed successfully",
      createdAt: new Date(),
      level: "info"
    }, io);
  }

  return channel.ack(msg);
}

    /* ================= FAILURE ================= */

    const maxRetry = step.retry ?? 0;
    const nextRetry = stepState.retryCount + 1;

    if (nextRetry <= maxRetry) {

      await Run.updateOne(
        { _id: runId },
        {
          $set: {
            [`stepStates.${stepIndex}.retryCount`]: nextRetry,
            [`stepStates.${stepIndex}.status`]: "retrying"
          }
        }
      );
      const updatedRun = await Run.findById(runId);
      emitRunUpdate(updatedRun, io);
      const delayMs = 2000 * Math.pow(2, nextRetry - 1);

      const stepDoc = workflow.steps[stepIndex];
      const stepPlain = typeof stepDoc.toObject === "function" ? stepDoc.toObject() : stepDoc;
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
      channel.sendToQueue(
        "step.retry.q",
        Buffer.from(JSON.stringify({
          runId,
          stepIndex,
          retryCount: nextRetry,
          timerId: randomUUID()
        })),
        {
          expiration: String(delayMs),
          persistent: true
        }
      );

      return channel.ack(msg);
    }
    await addRunLog(runId, {
      stepId: "system",
      message: "Run failed",
      createdAt: new Date(),
      level: "error"
    }, io);
    /* ---- Retry bitti ---- */

    const finishedAt = new Date();
    const freshRun = await Run.findById(runId);
    const startedAt = freshRun.stepStates[stepIndex].startedAt;
    const durationMs = startedAt ? (finishedAt - startedAt) : null;

    await Run.updateOne(
      { _id: runId },
      {
        $push: { logs: { stepId, message: `Step failed: ${error}`, createdAt: new Date() } },
        $set: {
          status: "failed",
          finishedAt,
          durationMs: finishedAt - run.createdAt,
          [`stepStates.${stepIndex}.status`]: "failed",
          [`stepStates.${stepIndex}.finishedAt`]: finishedAt,
          [`stepStates.${stepIndex}.durationMs`]: durationMs
        }
      }
    );
    
    const finalRun = await Run.findById(runId);
    emitRunUpdate(finalRun, io);
    emitRunLog(runId, finalRun.logs[finalRun.logs.length - 1], io);
    
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
    if (!run) return channel.ack(msg);

    // Zaten bitmişse dokunma (idempotent)
    if (["completed", "failed", "cancelled"].includes(run.status)) {
      return channel.ack(msg);
    }

    const finishedAt = new Date();

  await Run.updateOne(
    { _id: runId, status: { $nin: ["completed","failed","cancelled"] } },
    {
      $set: { status: "cancelled", finishedAt },
      $push: { logs: { stepId:"system", message: `Run cancelled${reason ? `: ${reason}` : ""}`, createdAt: new Date() } }
    }
  );
  
  const finalRun = await Run.findById(runId);
  emitRunUpdate(finalRun, io);
  emitRunLog(runId, finalRun.logs[finalRun.logs.length - 1], io);

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
    if (run.status === "cancelled") return channel.ack(msg);

    const workflow = await Workflow.findById(run.workflowId);
    if (!workflow) return channel.ack(msg);

    // Step’i tekrar running yap (duplicate fire’a karşı guard)
    const updatedRun = await markStepRunningIfRetrying({ runId, stepIndex, retryCount, io });
    if (!updatedRun) return channel.ack(msg);
    await addRunLog(
      runId,
      {
        stepId: workflow.steps[stepIndex].id,
        message: `Retry fired (attempt ${retryCount})`,
        createdAt: new Date(),
        level: "retry"
      },
      io
    );
    // ✅ Asıl önemli: params resolve + previousOutput burada yeniden üretiliyor
    await dispatchStep({ workflow, run: updatedRun, runId, stepIndex, channel, resolveVariables });

    return channel.ack(msg);
  } catch (err) {
    console.error("RETRY FIRE ERROR:", err);
    channel.nack(msg, false, true);
  }
});
  console.log("Orchestrator running (enterprise mode)...");
}
import { channel } from "../config/rabbit.js";
import { Run } from "../models/run.model.js";
import { Workflow } from "../models/workflow.model.js";
import { randomUUID } from "crypto";
import { resolveVariables } from "../utils/variableResolver.js";
import { evalCondition } from "../utils/condition.js";
import { redis } from "../config/redis.js";
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

const LAST_EMITTED_MAX = 200;
const lastEmittedByRunId = new Map();

function runStateSignature(run) {
  const steps = (run.stepStates || []).map(s => ({
    stepId: s.stepId,
    iteration: s.iteration ?? 0,
    status: s.status
  }));
  return JSON.stringify({ status: run.status, steps, logsLen: (run.logs || []).length });
}

function emitRunUpdate(run, io) {
  if (!io) return;

  const runId = run._id?.toString?.() ?? String(run._id);
  const sig = runStateSignature(run);
  const last = lastEmittedByRunId.get(runId);
  if (last && last === sig) return;
  lastEmittedByRunId.set(runId, sig);
  if (lastEmittedByRunId.size > LAST_EMITTED_MAX) {
    const firstKey = lastEmittedByRunId.keys().next().value;
    if (firstKey !== undefined) lastEmittedByRunId.delete(firstKey);
  }

  const payload = {
    id: runId,
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

function emitStepUpdate(runId, stepId, iteration, status, io) {
  if (!io) return;
  io.to(`run:${runId}`).emit("step:update", {
    runId: runId?.toString?.() ?? String(runId),
    stepId,
    iteration: iteration ?? 0,
    status
  });
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

/** Run.loopState is a Mongoose Map; use .get() or fallback to bracket notation for plain objects. */
function getLoopState(run, stepId) {
  const ls = run?.loopState;
  if (!ls) return undefined;
  if (typeof ls.get === "function") return ls.get(stepId);
  return ls[stepId];
}

function getStepState(run, stepId, iteration = 0) {

  let st = run.stepStates.find(
    s => s.stepId === stepId && s.iteration === iteration
  );

  if (!st) {
    st = {
      stepId,
      iteration,
      status: "pending",
      retryCount: 0
    };
  }

  return st;
}

function depsSatisfied(run, dependsOn = [], iteration = 0, activeLoopStepId = null, stepPlain = null) {
  if (!dependsOn?.length) return true;

  return dependsOn.every(depId => {
    // loop child step için özel kural:
    // foreach step completed olmayı bekleme; aktif loop context veya loopState index yeterli
    if (activeLoopStepId && depId === activeLoopStepId) {
      if (
        run.loopContext?.loopStepId === activeLoopStepId &&
        (run.loopContext?.index ?? 0) === iteration
      ) {
        return true;
      }
      // Step order: child may be checked before foreach sets loopContext; allow if loopState is at this iteration
      const loopState = getLoopState(run, activeLoopStepId);
      if (loopState && (loopState.index ?? 0) === iteration) {
        return true;
      }
      return false;
    }

    const st = run.stepStates.find(
      s => s.stepId === depId && (s.iteration ?? 0) === iteration
    );

    if (stepPlain?.errorFrom === depId && run?.lastError?.stepId === depId && st?.status === "failed") {
      return true;
    }
    return st && (st.status === "completed" || st.status === "skipped");
  });
}

function buildPrevOutput(run, dependsOn = [], iteration = 0) {

  if (!dependsOn?.length) return null;

  const obj = {};

  for (const depId of dependsOn) {
    obj[depId] = run.outputs?.[depId]?.[iteration];
  }

  return obj;
}

/** For error-handler steps (errorFrom), returns lastError payload; otherwise buildPrevOutput. */
function getPreviousOutput(run, stepPlain, iteration = 0) {
  const errFrom = stepPlain?.errorFrom;
  const lastErr = run?.lastError;
  if (errFrom && lastErr && lastErr.stepId === errFrom && (lastErr.iteration ?? 0) === (iteration ?? 0)) {
    return { error: lastErr.message, stepId: lastErr.stepId, iteration: lastErr.iteration };
  }
  return buildPrevOutput(run, stepPlain?.dependsOn ?? [], iteration);
}

/**
 * True if this step is inside the loop: it depends on loopStepId directly or transitively.
 * Only such steps should use loop iteration; steps like HTTP before the loop must stay at iteration 0.
 */
function isStepInsideLoop(stepId, loopStepId, workflow) {
  const steps = workflow.steps || [];
  const visited = new Set();
  function dependsOnLoop(id) {
    if (visited.has(id)) return false;
    visited.add(id);
    const step = steps.find(s => s.id === id);
    if (!step?.dependsOn?.length) return false;
    if (step.dependsOn.includes(loopStepId)) return true;
    return step.dependsOn.some(depId => dependsOnLoop(depId));
  }
  return dependsOnLoop(stepId);
}

/**
 * All steps that belong to this loop iteration: direct children of the loop
 * plus any step that depends (transitively) on one of them. We must wait for
 * all of these to complete before advancing the loop so that loopContext
 * (loop.item) is still available when resolving params for steps like email/log.
 */
function isLoopIterationDone(run, loopStepId, iteration, workflow) {
  const steps = workflow.steps || [];

  const inIteration = new Set();
  function addDescendants(stepId) {
    if (inIteration.has(stepId)) return;
    inIteration.add(stepId);
    for (const s of steps) {
      if (s.dependsOn?.includes(stepId)) addDescendants(s.id);
    }
  }
  for (const s of steps) {
    if (s.dependsOn?.includes(loopStepId)) addDescendants(s.id);
  }

  if (!inIteration.size) return true;

  for (const stepId of inIteration) {
    const st = run.stepStates.find(
      s => s.stepId === stepId && (s.iteration ?? 0) === iteration
    );
    if (!st) return false;
    if (!["completed", "skipped"].includes(st.status)) return false;
  }
  return true;
}


async function handleIfStepDAG({ workflow, run, stepIndex, iteration = 0, io }) {

  
  const step = workflow.steps[stepIndex];
  const stepId = step.id;

  const conditionExpr = step.params?.condition ?? "";
  const thenGoto = step.params?.thenGoto;
  const elseGoto = step.params?.elseGoto;

  const ok = evalCondition(conditionExpr, buildContext(run));

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

  // Rejected branch'i skip edebilmek için hedef adımların stepState'i olmalı (yoksa skipBranch bulamaz).
  const runId = run._id.toString();
  if (typeof thenGoto === "string" && thenGoto.trim()) {
    await ensurePendingStepState({ runId, stepId: thenGoto, iteration: iteration ?? 0 });
  }
  if (typeof elseGoto === "string" && elseGoto.trim()) {
    await ensurePendingStepState({ runId, stepId: elseGoto, iteration: iteration ?? 0 });
  }
  const runWithBranchStates = await Run.findById(runId);
  const runForSkip = runWithBranchStates || run;

  // rejected branch'i skip et
  if (rejected) {
    await skipBranch(workflow, runId, runForSkip, rejected, iteration, io);
  }

  const finishedAt = new Date();

  const res = await Run.updateOne(
    {
      _id: run._id,
      status: { $nin: ["failed", "completed", "cancelled"] },
      stepStates: {
        $elemMatch: {
          stepId,
          iteration: iteration ?? 0,
          status: "pending"
        }
      }
    },
    {
      $set: {
        "stepStates.$.status": "completed",
        "stepStates.$.finishedAt": finishedAt,
        [`outputs.${stepId}.${iteration ?? 0}`]: { result: ok }
      }
    }
  );

  if (res.modifiedCount === 0) return;
  await addRunLog(
    run._id.toString(),
    {
      stepId,
      message: "[STEP COMPLETE] (IF step)",
      level: "info",
      createdAt: new Date()
    },
    io
  );
  const updatedRun = await Run.findById(run._id);
  emitRunUpdate(updatedRun, io);
  return { selectedStepId: ok ? thenGoto : elseGoto };
}

async function dispatchReadySteps({
  runId,
  channel,
  resolveVariables,
  io
}) {

  let run = await Run.findById(runId);
  if (!run) return;
  if (["failed", "completed", "cancelled"].includes(run.status)) return;

  const workflow = run.workflowSnapshot;
  if (!workflow || !workflow.steps?.length) return;

  const runningCount = run.stepStates.filter( s => ["running", "retrying"].includes(s.status) ).length;
  const maxParallel = workflow.maxParallel ?? 5;
  const availableSlots = maxParallel - runningCount;

  if (availableSlots <= 0) {
    await enqueueReadyRun(runId);
    return;
  }

  const readyIndexes = [];

  for (let i = 0; i < workflow.steps.length; i++) {

    const stepPlain = toPlain(workflow.steps[i]);

    let iteration = 0;
    let activeLoopStepIdForDeps = null;
    // For both normal steps and IF steps: use loop context only for steps *inside* the loop
    // (they depend on the foreach). Steps before the loop (e.g. HTTP) must stay at iteration 0.
    if (stepPlain.type !== "foreach") {
      if (run.loopContext?.loopStepId) {
        if (isStepInsideLoop(stepPlain.id, run.loopContext.loopStepId, workflow)) {
          iteration = run.loopContext.index ?? 0;
          activeLoopStepIdForDeps = run.loopContext.loopStepId;
        }
      } else {
        const parentLoop = workflow.steps.find(s =>
          s.id !== stepPlain.id &&
          stepPlain.dependsOn?.includes(s.id) &&
          s.type === "foreach"
        );

        if (parentLoop) {
          iteration = (getLoopState(run, parentLoop.id)?.index ?? 0);
          activeLoopStepIdForDeps = parentLoop.id;
        }
        // When loopContext is unset but step is inside a loop, that loop has finished —
        // don't run this step again (would use wrong iteration or no loop.item).
        const ls = run.loopState;
        const loopIds = ls instanceof Map ? [...ls.keys()] : (ls ? Object.keys(ls) : []);
        if (!run.loopContext?.loopStepId && loopIds.length > 0) {
          const insideFinishedLoop = loopIds.some(
            loopId => isStepInsideLoop(stepPlain.id, loopId, workflow)
          );
          if (insideFinishedLoop) continue;
        }
      }
    }
    const stepState = run.stepStates.find(
      s => s.stepId === stepPlain.id && (s.iteration ?? 0) === iteration
    );

    const st = stepState ?? {
      stepId: stepPlain.id,
      iteration,
      status: "pending",
      retryCount: 0
    };

    if (st.status !== "pending") continue;

    /* ================= DISABLED STEP ================= */
    if (stepPlain.disabled) {
      await ensurePendingStepState({
        runId,
        stepId: stepPlain.id,
        iteration
      });
      await Run.updateOne(
        { _id: runId },
        {
          $set: {
            "stepStates.$[s].status": "skipped",
            "stepStates.$[s].finishedAt": new Date(),
            [`outputs.${stepPlain.id}.${iteration}`]: null
          }
        },
        {
          arrayFilters: [
            { "s.stepId": stepPlain.id, "s.iteration": iteration, "s.status": "pending" }
          ]
        }
      );
      await addRunLog(
        runId,
        { stepId: stepPlain.id, message: "Step disabled", createdAt: new Date(), level: "system" },
        io
      );
      emitStepUpdate(runId, stepPlain.id, iteration, "skipped", io);
      return dispatchReadySteps({
        runId,
        channel,
        resolveVariables,
        io
      });
    }

    /* ================= IF STEP ================= */

    if (stepPlain.type === "if") {

      await ensurePendingStepState({
        runId,
        stepId: stepPlain.id,
        iteration
      });

      if (depsSatisfied(run, stepPlain.dependsOn, iteration, activeLoopStepIdForDeps, stepPlain)) {

        const ifResult = await handleIfStepDAG({
          workflow,
          run,
          stepIndex: i,
          iteration,
          io
        });

        run = await Run.findById(runId);
        if (!run) return;
        const selectedStepId = ifResult?.selectedStepId;
        if (typeof selectedStepId === "string" && selectedStepId.trim()) {
          const j = workflow.steps.findIndex(s => s.id === selectedStepId);
          if (j >= 0 && !readyIndexes.some(r => r.index === j && r.iteration === iteration)) {
            readyIndexes.push({
              index: j,
              iteration,
              loopStepId: activeLoopStepIdForDeps ?? undefined
            });
          }
        }
        continue;
      }

      continue;
    }

    /* ================= FOREACH STEP ================= */

    if (stepPlain.type === "foreach") {

      await ensurePendingStepState({
        runId,
        stepId: stepPlain.id,
        iteration: 0
      });

      if (!depsSatisfied(run, stepPlain.dependsOn, 0)) continue;

      let loopState = getLoopState(run, stepPlain.id);
      let items;

      /* FIRST ITERATION */

      if (!loopState) {

        const context = buildContext(run);
        items = resolveVariables(stepPlain.params?.items, context);
        console.log("items", items);
        if (!Array.isArray(items)) {
          if (typeof items === "string") {
            try {
              const parsed = JSON.parse(items);
              if (Array.isArray(parsed)) items = parsed;
            } catch {
              // ignore
            }
          }
          if (!Array.isArray(items) && items && typeof items === "object" && typeof items.output !== "undefined") {
            const inner = items.output;
            if (Array.isArray(inner)) items = inner;
            else if (typeof inner === "string") {
              try {
                const parsed = JSON.parse(inner);
                if (Array.isArray(parsed)) items = parsed;
              } catch {
                // ignore
              }
            }
          }
          if (!Array.isArray(items)) {
            throw new Error("foreach items must be array");
          }
        }

        const initialLoopContext = {
          loopStepId: stepPlain.id,
          index: 0,
          item: items[0] ?? null
        };

        await Run.updateOne(
          { _id: runId },
          {
            $set: {
              [`loopState.${stepPlain.id}`]: {
                index: 0,
                items
              },
              loopContext: initialLoopContext
            }
          }
        );

        return dispatchReadySteps({
          runId,
          channel,
          resolveVariables,
          io
        });
      }

      items = loopState.items;

      const currentIndex = loopState.index ?? 0;

      /* LOOP FINISHED */

      if (currentIndex >= items.length) {

        await Run.updateOne(
          {
            _id: runId,
            stepStates: {
              $elemMatch: {
                stepId: stepPlain.id,
                iteration: 0,
                status: "pending"
              }
            }
          },
          {
            $set: {
              "stepStates.$.status": "completed",
              "stepStates.$.finishedAt": new Date()
            },
            $unset: {
              loopContext: ""
            }
          }
        );

        return dispatchReadySteps({
          runId,
          channel,
          resolveVariables,
          io
        });
      }

      /* ITERATION DONE CHECK */

      const latestRun = await Run.findById(runId);
      if (!latestRun) return;

      const iterationDone = isLoopIterationDone(
        latestRun,
        stepPlain.id,
        currentIndex,
        workflow
      );
      if (iterationDone) {

        const nextIndex = currentIndex + 1;

        if (nextIndex >= items.length) {
          await Run.updateOne(
            {
              _id: runId,
              stepStates: {
                $elemMatch: {
                  stepId: stepPlain.id,
                  iteration: 0,
                  status: "pending"
                }
              }
            },
            {
              $inc: { [`loopState.${stepPlain.id}.index`]: 1 },
              $unset: { loopContext: "" },
              $set: {
                "stepStates.$.status": "completed",
                "stepStates.$.finishedAt": new Date()
              }
            }
          );
        } else {
          const nextLoopContext = {
            loopStepId: stepPlain.id,
            index: nextIndex,
            item: items[nextIndex] ?? null
          };
          await Run.updateOne(
            { _id: runId },
            {
              $inc: { [`loopState.${stepPlain.id}.index`]: 1 },
              $set: { loopContext: nextLoopContext }
            }
          );
        }

        await addRunLog(
          runId,
          {
            stepId: stepPlain.id,
            message: `[FOREACH ITERATION] ${stepPlain.id} advanced to index ${nextIndex}`,
            createdAt: new Date(),
            level: "system"
          },
          io
        );

        return dispatchReadySteps({
          runId,
          channel,
          resolveVariables,
          io
        });
      }

      /* LOOP CONTEXT */

       const nextLoopContext = {
        loopStepId: stepPlain.id,
        item: items[currentIndex],
        index: currentIndex
      };

      const sameLoopContext =
        run.loopContext?.loopStepId === stepPlain.id &&
        (run.loopContext?.index ?? 0) === currentIndex;

      if (!sameLoopContext) {
        await Run.updateOne(
          { _id: runId },
          {
            $set: {
              loopContext: nextLoopContext
            }
          }
        );

        // local state'i de güncelle ki aynı pass'te child step scan edilebilsin
        run.loopContext = nextLoopContext;
      }

      // BURADA recurse ETME
      // child step'lerin ready olup olmadığını aynı for-loop'ta kontrol et
      continue;
    }

    /* ================= NORMAL STEP ================= */

    const loopIteration = iteration;
const loopStepId = run.loopContext?.loopStepId ?? activeLoopStepIdForDeps ?? null;

const depsOk = depsSatisfied(
  run,
  stepPlain.dependsOn,
  loopIteration,
  loopStepId,
  stepPlain
);

    if (depsOk) {

      if (!readyIndexes.some(r => r.index === i && r.iteration === loopIteration)) {
        readyIndexes.push({
          index: i,
          iteration: loopIteration,
          loopStepId
        });
      }
    }
  }

  const limited = readyIndexes.slice(0, availableSlots);

  if (!limited.length) {
    if (runningCount === 0) {
      await addRunLog(
        runId,
        {
          stepId: "system",
          message: `[RUN] No ready steps and no running steps; exiting without re-enqueue runId=${runId}`,
          createdAt: new Date(),
          level: "system"
        },
        io
      );
    }
    return;
  }

  for (const item of limited) {

    const stepPlain = toPlain(workflow.steps[item.index]);

    if (stepPlain.type === "foreach" || stepPlain.type === "if") {
      continue;
    }

    const executionId = randomUUID();

    await addRunLog(
      runId,
      {
        stepId: stepPlain.id,
        message: `[STEP READY] ${stepPlain.id} iteration=${item.iteration ?? 0}`,
        createdAt: new Date(),
        level: "system"
      },
      io
    );

    const globalToken = await acquireGlobalSlot({
      runId,
      stepId: stepPlain.id,
      executionId
    });

    if (!globalToken) {
      await enqueueReadyRun(runId);
      continue;
    }

    await ensurePendingStepState({
      runId,
      stepId: stepPlain.id,
      iteration: item.iteration ?? 0
    });

    const moved = await movePendingToRunning({
      runId,
      stepId: stepPlain.id,
      iteration: item.iteration ?? 0,
      executionId
    });

    if (!moved) {
      await releaseGlobalSlot(globalToken);
      continue;
    }

    emitStepUpdate(runId, stepPlain.id, item.iteration ?? 0, "running", io);

    const previousOutput = getPreviousOutput(run, stepPlain, item.iteration ?? 0);

    const resolvedParams = resolveVariables(
      stepPlain.params ?? {},
      buildContext(run)
    );

    await addRunLog(
      runId,
      {
        stepId: stepPlain.id,
        message: `[STEP START] ${stepPlain.id} iteration=${item.iteration ?? 0} executionId=${executionId}`,
        createdAt: new Date(),
        level: "system"
      },
      io
    );

    try {

      await publishStepExecution({
        channel,
        stepPlain,
        runId,
        stepIndex: item.index,
        iteration: item.iteration ?? 0,
        loopStepId: item.loopStepId ?? null,
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
        Buffer.from(
          JSON.stringify({
            runId,
            stepIndex: item.index,
            executionId,
            globalToken,
            iteration: item.iteration ?? 0,
            loopStepId: item.loopStepId ?? null
          })
        ),
        {
          expiration: String(stepPlain.timeout),
          persistent: true
        }
      );
    }
  }

  const updatedRun = await Run.findById(runId);

  if (updatedRun) {
    emitRunUpdate(updatedRun, io);
  }
}


function isRunDone(workflow, run) {
  return workflow.steps.every((sdoc) => {
    const s = toPlain(sdoc);

    if (s.type === "foreach") {
      const loop = getLoopState(run, s.id);
      const loopDone = !loop || loop.index >= (loop.items?.length ?? 0);

      const st = run.stepStates.find(
        x => x.stepId === s.id && (x.iteration ?? 0) === 0
      );

      return loopDone && st && ["completed", "skipped"].includes(st.status);
    }

    const states = run.stepStates.filter(x => x.stepId === s.id);

    if (!states.length) return false;

    return states.every(x => ["completed", "skipped"].includes(x.status));
  });
}

async function skipBranch(workflow, runId, run, rootStepId, iteration = 0, io) {

  const iter = iteration ?? 0;
  const stepStatesInIter = run.stepStates.filter(s => (s.iteration ?? 0) === iter);
  const byId = new Map(stepStatesInIter.map(s => [s.stepId, s]));
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
        { "s.stepId": { $in: skippedIds }, "s.iteration": iter, "s.status": "pending" }
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

/**
 * When a switch step completes, skip downstream steps whose branch does not match the switch output.
 * Steps that dependOn the switch step are kept only if step.branch is undefined or === selectedBranch.
 */
async function skipNonMatchingSwitchBranches(workflow, runId, run, switchStepId, selectedBranch, io) {
  if (selectedBranch == null || selectedBranch === "") return;
  const steps = workflow.steps || [];
  const runAgain = await Run.findById(runId);
  const currentRun = runAgain || run;
  const byId = new Map(currentRun.stepStates.map(s => [s.stepId, s]));
  const toSkip = [];
  for (const s of steps) {
    const stepPlain = toPlain(s);
    if (!stepPlain.dependsOn?.includes(switchStepId)) continue;
    const branch = stepPlain.branch;
    if (branch == null || branch === "") continue;
    if (branch === selectedBranch) continue;
    toSkip.push(stepPlain.id);
  }
  let r = currentRun;
  for (const rootStepId of toSkip) {
    await skipBranch(workflow, runId, r, rootStepId, 0, io);
    r = await Run.findById(runId);
    if (!r) break;
  }
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
    const skippedSteps = runDoc?.stepStates?.filter(
      s => s.status === "skipped"
    ) || [];

    cancelledSteps.forEach(st => emitStepUpdate(runId, st.stepId, st.iteration ?? 0, "cancelled", io));
    skippedSteps.forEach(st => emitStepUpdate(runId, st.stepId, st.iteration ?? 0, "skipped", io));

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

/**
 * Get the effective output for a step for variable resolution.
 * run.outputs is keyed by stepId; each value may be iteration-keyed (e.g. { "0": result }).
 * We expose the first iteration's value so that steps.<stepId>.output resolves correctly.
 * If that value is a plain array (e.g. from OpenAI), wrap as { output } so steps.x.output works.
 */
function getStepOutputForContext(outputs, stepId) {
  let raw = outputs instanceof Map ? outputs.get(stepId) : outputs?.[stepId];
  if (raw == null) return undefined;
  // Unwrap iteration-keyed container (outputs are stored as outputs[stepId][iteration])
  if (typeof raw === "object" && !Array.isArray(raw) && raw !== null) {
    const entries = raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw);
    const firstNumeric = entries.find(([k]) => String(Number(k)) === k);
    raw = firstNumeric ? (raw instanceof Map ? raw.get(firstNumeric[0]) : raw[firstNumeric[0]]) : (raw instanceof Map ? raw.get("0") : raw["0"]) ?? raw;
  }
  if (raw == null) return undefined;
  // So that steps.<stepId>.output works: if value is a plain array, expose as { output }
  if (Array.isArray(raw)) return { output: raw };
  return raw;
}

function buildContext(run) {
  const outputsRaw =
    run.outputs instanceof Map
      ? Object.fromEntries(run.outputs)
      : run.outputs || {};

  const stepIds = Object.keys(outputsRaw);
  const steps = {};
  for (const stepId of stepIds) {
    const effective = getStepOutputForContext(
      run.outputs instanceof Map ? run.outputs : outputsRaw,
      stepId
    );
    if (effective !== undefined) steps[stepId] = effective;
  }

  return {
    steps,
    run,
    trigger: run.triggerPayload || {},
    env: process.env,
    loop: run.loopContext || {}
  };
}

async function ensurePendingStepState({
  runId,
  stepId,
  iteration = 0
}) {
  const res = await Run.updateOne(
    {
      _id: runId,
      stepStates: {
        $not: {
          $elemMatch: { stepId, iteration }
        }
      }
    },
    {
      $push: {
        stepStates: {
          stepId,
          iteration,
          status: "pending",
          retryCount: 0
        }
      }
    }
  );

  return res.modifiedCount === 1;
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

    const isReplay = run.workflowSnapshot?.steps?.length > 0 && Array.isArray(run.stepStates) && run.stepStates.length > 0;

    if (isReplay) {
      await Run.updateOne(
        { _id: runId },
        {
          $set: {
            status: "running",
            processedMessages: []
          }
        }
      );
    } else {
      await Run.updateOne(
        { _id: runId },
        {
          $set: {
            status: "running",
            currentStepIndex: 0,
            processedMessages: [],
            outputs: {},
            workflowSnapshot: snapshot,
            stepStates: [],
            loopState: {},
            loopContext: {}
          }
        }
      );
    }

    const updatedRun = await Run.findById(runId);
    emitRunUpdate(updatedRun, io);

    await addRunLog(
      runId,
      {
        stepId: "system",
        message: `[RUN START] runId=${runId}`,
        createdAt: new Date(),
        level: "system"
      },
      io
    );

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
      iteration,
      error,
      globalToken,
      loopStepId
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

    let stepState = run.stepStates.find(s => s.stepId === stepId && (s.iteration ?? 0) === (iteration ?? 0));
    if (!stepState) {
      stepState = { stepId, retryCount: 0, status: "pending" };
      run.stepStates.push(stepState);
    }

    /* ================= SUCCESS ================= */
       if (success) {
        
     const logEntry = {
       stepId,
       message: `[STEP COMPLETE] ${stepId} iteration=${iteration ?? 0}`,
       createdAt: new Date(),
       level: "info"
     };
   
     const finishedAt = new Date();
   
     const freshRun = await Run.findById(runId);
     const currentState = freshRun?.stepStates?.find( s =>
        s.stepId === stepId &&
        (s.iteration ?? 0) === (iteration ?? 0) &&
        s.executionId === executionId
     );

    const startedAt = currentState?.startedAt;
   
     const durationMs = startedAt
       ? finishedAt.getTime() - new Date(startedAt).getTime()
       : null;
   
     const res = await Run.updateOne(
      {
        _id: runId,
        status: { $nin: ["failed", "completed", "cancelled"] },
        stepStates: {
          $elemMatch: {
            stepId,
            iteration: iteration ?? 0,
            status: "running",
            executionId
          }
        }
      },
      {
        $push: { logs: logEntry },
        $set: {
          "stepStates.$.status": "completed",
          "stepStates.$.finishedAt": finishedAt,
          "stepStates.$.durationMs": durationMs,
          [`outputs.${stepId}.${iteration ?? 0}`]: output
        }
      }
    );
   
     if (res.modifiedCount === 0) {
       await releaseGlobalSlot(globalToken);
       return channel.ack(msg);
     }
   
     emitStepUpdate(runId, stepId, iteration, "completed", io);
     emitRunLog(runId, logEntry, io);
   
     const updatedRun = await Run.findById(runId);
     emitRunUpdate(updatedRun, io);

     const stepPlain = toPlain(step);
     if (stepPlain?.errorFrom) {
       await Run.updateOne({ _id: runId }, { $unset: { lastError: 1 } });
     }
     if (stepPlain?.type === "switch") {
       const selectedBranch = output?.output?.branch ?? output?.branch;
       if (selectedBranch != null) {
         await skipNonMatchingSwitchBranches(updatedRun.workflowSnapshot, runId, updatedRun, stepId, selectedBranch, io);
       }
     }
   
     await releaseGlobalSlot(globalToken);
   
     if (["failed", "completed", "cancelled"].includes(updatedRun.status)) {
       return channel.ack(msg);
     }
 
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
           message: "[RUN COMPLETE] Run completed successfully",
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
            message: `[STEP FAIL] ${stepId}: ${error}`,
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
          stepStates: {
            $elemMatch: {
              stepId,
              iteration: iteration ?? 0,
              status: "running",
              executionId
            }
          }
        },
        {
          $set: {
            "stepStates.$.retryCount": nextRetry,
            "stepStates.$.status": "retrying"
          }
        }
      );

      // stale result guard
      if (res.modifiedCount === 0) {
        await releaseGlobalSlot(globalToken);
        return channel.ack(msg);
      }

      emitStepUpdate(runId, stepId, iteration, "retrying", io);
      const updatedRun = await Run.findById(runId);
      emitRunUpdate(updatedRun, io);

      const delayMs = typeof step.retryDelay === "number" && step.retryDelay >= 0
        ? step.retryDelay
        : 2000 * Math.pow(2, nextRetry - 1);

      await addRunLog(
        runId,
        {
          stepId,
          message: `[STEP RETRY] Retry scheduled in ${delayMs}ms (attempt ${nextRetry}/${maxRetry})`,
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
            iteration: iteration ?? 0,
            loopStepId: loopStepId ?? null,
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
    const currentState = freshRun?.stepStates?.find(s =>
      s.stepId === stepId &&
      (s.iteration ?? 0) === (iteration ?? 0) &&
      s.executionId === executionId
    );

    const startedAt = currentState?.startedAt;
    const durationMs = startedAt
      ? finishedAt.getTime() - new Date(startedAt).getTime()
      : null;

    // Timeout ise "Step failed" logunu timeout consumer basıyor olabilir.
    // Burada sadece timeout DEĞİLSE step fail log basıyoruz.
    const stepFailLog = !isTimeout
      ? {
          stepId,
          message: `[STEP FAIL] ${stepId}: ${error}`,
          createdAt: new Date(),
          level: "error"
        }
      : null;

    // DB update: set step to failed first (run status may stay running if error port is used)
    const stepUpdate = {
      $set: {
        "stepStates.$.status": "failed",
        "stepStates.$.finishedAt": finishedAt,
        "stepStates.$.durationMs": durationMs
      }
    };
    if (stepFailLog) stepUpdate.$push = { logs: stepFailLog };

    const res = await Run.updateOne(
      {
        _id: runId,
        status: { $nin: ["completed", "failed", "cancelled"] },
        stepStates: {
          $elemMatch: {
            stepId,
            iteration: iteration ?? 0,
            executionId,
            status: { $in: ["running", "retrying"] }
          }
        }
      },
      stepUpdate
    );

    if (res.modifiedCount === 0) {
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    emitStepUpdate(runId, stepId, iteration, "failed", io);
    if (stepFailLog) emitRunLog(runId, stepFailLog, io);

    const wfSnapshot = run.workflowSnapshot;
    const errorHandlerSteps = wfSnapshot?.steps?.filter(s => s.errorFrom === stepId) ?? [];

    if (errorHandlerSteps.length > 0) {
      const lastError = { stepId, message: error, iteration: iteration ?? 0 };
      const errStepIds = errorHandlerSteps.map(s => s.id);
      await Run.updateOne({ _id: runId }, { $set: { lastError } });

      const runDoc = await Run.findById(runId);
      const existingIds = new Set((runDoc?.stepStates ?? []).filter(st => st.stepId && (st.iteration ?? 0) === 0).map(st => st.stepId));
      const toAdd = errStepIds.filter(id => !existingIds.has(id)).map(id => ({
        stepId: id,
        iteration: 0,
        status: "pending",
        retryCount: 0
      }));
      if (toAdd.length > 0) {
        await Run.updateOne({ _id: runId }, { $push: { stepStates: { $each: toAdd } } });
      } else {
        await Run.updateOne(
          { _id: runId },
          { $set: { "stepStates.$[s].status": "pending" } },
          { arrayFilters: [{ "s.stepId": { $in: errStepIds }, "s.iteration": 0 }] }
        );
      }
      await enqueueReadyRun(runId);
      await dispatchReadySteps({ runId, channel, resolveVariables, io });
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    await dequeueReadyRun(runId);
    const failRunUpdate = {
      $set: {
        status: "failed",
        finishedAt,
        durationMs: finishedAt.getTime() - run.createdAt.getTime()
      }
    };
    await Run.updateOne({ _id: runId }, failRunUpdate);

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

    for (const s of finalRun.stepStates) {
      if (s.status === "cancelled" || s.status === "skipped") {
        emitStepUpdate(runId, s.stepId, s.iteration ?? 0, s.status, io);
      }
    }
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
    const { runId, stepIndex, retryCount , iteration = 0, loopStepId = null} = JSON.parse(msg.content.toString());

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

 
    const moved = await moveRetryingToRunning({
      runId,
      stepId: stepPlain.id,
      retryCount,
      executionId,
      iteration
    });

    if (!moved) {
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    emitStepUpdate(runId, stepPlain.id, iteration, "running", io);
    const updatedRun = await Run.findById(runId);
    emitRunUpdate(updatedRun, io);

    const previousOutput = getPreviousOutput(updatedRun, stepPlain, iteration);
    const resolvedParams = resolveVariables(stepPlain.params ?? {}, buildContext(updatedRun));

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
        globalToken,
        iteration,
        loopStepId
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
          globalToken,
          iteration,
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
    const { runId, stepIndex, executionId, globalToken, iteration = 0, loopStepId = null} =
    JSON.parse(msg.content.toString());
    
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
    const stepId = step?.id;


    const stepState = run.stepStates.find(
      s =>
        s.stepId === stepId &&
        (s.iteration ?? 0) === iteration &&
        s.status === "running"
    );
    
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
          stepStates: {
            $elemMatch: {
              stepId,
              iteration,
              status: "running",
              executionId
            }
          }
        },
        {
          $set: {
            "stepStates.$.status": "retrying",
            "stepStates.$.retryCount": nextRetry
          }
        }
      );
    
      if (res.modifiedCount === 0) {
        await releaseGlobalSlot(globalToken);
        return channel.ack(msg);
      }
      emitStepUpdate(runId, step.id, iteration, "retrying", io);
      await addRunLog(
        runId,
        {
          stepId: step.id,
          message: "[STEP TIMEOUT] Timeout exceeded",
          level: "error",
          createdAt: new Date()
        },
        io
      );
      await addRunLog(
        runId,
        {
          stepId: step.id,
          message: "[STEP FAIL] Timeout exceeded",
          level: "error",
          createdAt: new Date()
        },
        io
      );
      const delayMs = typeof step.retryDelay === "number" && step.retryDelay >= 0
        ? step.retryDelay
        : 2000 * Math.pow(2, nextRetry - 1);
    
      await addRunLog(
        runId,
        {
          stepId: step.id,
          message: `[STEP RETRY] Retry scheduled in ${delayMs}ms (attempt ${nextRetry}/${maxRetry})`,
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
            retryCount: nextRetry,
            iteration,
            loopStepId
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
      {
        _id: runId,
        stepStates: {
          $elemMatch: {
            stepId,
            iteration,
            executionId,
            status: "running"
          }
        }
      },
      {
        $set: {
          "stepStates.$.status": "failed",
          "stepStates.$.finishedAt": finishedAt
        }
    });

    emitStepUpdate(runId, step.id, iteration, "failed", io);
    await addRunLog(
      runId,
      {
        stepId: step.id,
        message: "[STEP TIMEOUT] Timeout exceeded (no retries left)",
        level: "error",
        createdAt: new Date()
      },
      io
    );
    await addRunLog(
      runId,
      {
        stepId: step.id,
        message: "[STEP FAIL] Timeout exceeded",
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
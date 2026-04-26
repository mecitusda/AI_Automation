import { channel } from "../config/rabbit.js";
import { Run } from "../models/run.model.js";
import { Workflow } from "../models/workflow.model.js";
import { randomUUID } from "crypto";
import { resolveVariables } from "../utils/variableResolver.js";
import { evalCondition } from "../utils/condition.js";
import { redis } from "../config/redis.js";
import { publishStepExecution } from "./executionEngine.js";
import { movePendingToRunning, moveRetryingToRunning } from "./stateEngine.js";
import { logError, logInfo } from "../utils/logger.js";
import { withRedisFallback } from "../utils/redisSafe.js";
import { getRunRetryBudget, isBreakerOpen, recordStepFailure } from "../utils/retryGuard.js";
import { incrMetric } from "../utils/metricsCounter.js";
import { redactExecutionParams } from "../utils/redactExecutionParams.js";


const READY_ZSET = "runs:ready";
const GLOBAL_MAX = Number(process.env.GLOBAL_MAX_INFLIGHT || 10);
const PROCESSED_MESSAGES_CAP = Number(process.env.PROCESSED_MESSAGES_CAP || 1000);
const inferredDependencyModeWarnings = new Set();
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
  await withRedisFallback(
    "orchestrator.enqueue_ready_run",
    async () => redis.zadd(READY_ZSET, "NX", Date.now(), runId),
    null
  );
}

async function dequeueReadyRun(runId) {
  await withRedisFallback(
    "orchestrator.dequeue_ready_run",
    async () => redis.zrem(READY_ZSET, runId),
    null
  );
}

async function acquireGlobalSlot({ runId, stepId, executionId }) {
  const token = `${runId}:${stepId}:${executionId}`;
  const ok = await withRedisFallback(
    "orchestrator.acquire_global_slot",
    async () => redis.eval(ACQUIRE_LUA, 2, INF_KEY, TOK_SET, String(GLOBAL_MAX), token, String(TOK_TTL_MS)),
    1
  );
  return ok === 1 ? token : null;
}

async function releaseGlobalSlot(token) {
  if (!token) return;
  const removed = await withRedisFallback(
    "orchestrator.release_global_slot",
    async () => redis.eval(RELEASE_LUA, 2, INF_KEY, TOK_SET, token),
    0
  );

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
  const inf = Number(await withRedisFallback("orchestrator.get_inflight", async () => redis.get(INF_KEY), "0") || 0);
  const free = GLOBAL_MAX - inf;
  if (free <= 0) return;

  const batch = Math.min(free, 10);

  const runIds = await withRedisFallback("orchestrator.get_ready_runs", async () => redis.zrange(READY_ZSET, 0, batch - 1), []);
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
    const hasWorkerInflight = hasWorkerInflightStepStates(fresh.stepStates, fresh.workflowSnapshot);
    if (!hasPending && !hasWorkerInflight) {
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
    logs: run.logs,
    loopState: run.loopState || {}
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

async function persistStepExecutionInput(runId, stepId, iteration, executionId, resolvedParams) {
  const key = `${stepId}::${iteration}`;
  const redacted = redactExecutionParams(resolvedParams);
  await Run.updateOne(
    { _id: runId },
    {
      $set: {
        [`stepInputs.${key}`]: {
          executionId,
          params: redacted,
          startedAt: new Date().toISOString()
        }
      }
    }
  );
}

function toPlain(stepDoc) {
  return typeof stepDoc?.toObject === "function" ? stepDoc.toObject() : stepDoc;
}

/** Worker-queue steps only; foreach/if are orchestrator-internal and must not block ready-queue dequeue. */
function hasWorkerInflightStepStates(stepStates, workflow) {
  if (!stepStates?.length || !workflow?.steps?.length) return false;
  return stepStates.some((s) => {
    if (!["running", "retrying"].includes(s.status)) return false;
    const meta = workflow.steps.find((wf) => toPlain(wf).id === s.stepId);
    const typ = meta ? toPlain(meta).type : "";
    if (typ === "foreach" || typ === "if") return false;
    return true;
  });
}

/** Plain steps for Run.workflowSnapshot (avoids losing nested fields when copying Workflow → Run). */
function snapshotStepsPlain(steps) {
  if (!Array.isArray(steps) || !steps.length) return [];
  return steps.map((s) => toPlain(s));
}

function coerceForeachItems(rawItems) {
  let items = rawItems;
  if (Array.isArray(items)) return items;

  if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items);
      if (Array.isArray(parsed)) return parsed;
      items = parsed;
    } catch {
      // keep original
    }
  }

  if (items && typeof items === "object") {
    // Common wrappers from previous step outputs.
    const candidates = [
      items.output,
      items.items,
      items.payments,
      items.data
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) return c;
      if (typeof c === "string") {
        try {
          const parsed = JSON.parse(c);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // ignore candidate
        }
      }
    }
  }

  return items;
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

function depsSatisfied(
  run,
  dependsOn = [],
  iteration = 0,
  activeLoopStepId = null,
  stepPlain = null,
  workflow = null,
  dependencyModeCache = null
) {
  if (!dependsOn?.length) return true;

  // Workflow-level onError fallback:
  // If this step is the configured onError handler, allow it to run as soon as
  // orchestration has recorded a failure for the same iteration.
  const onErrorStepId = workflow?.onErrorStepId;
  if (
    onErrorStepId &&
    stepPlain?.id === onErrorStepId &&
    run?.lastError?.stepId &&
    (run.lastError.iteration ?? 0) === (iteration ?? 0)
  ) {
    return true;
  }

  return dependsOn.every(depId => {
    const depStep = workflow?.steps?.find((s) => s.id === depId);
    const depStepPlain = depStep ? toPlain(depStep) : null;
    const depMode = getDependencyMode({
      stepPlain,
      depId,
      workflow,
      dependencyModeCache
    });
    if (depStepPlain?.type === "foreach") {
      // iteration mode: child can run during active loop iteration.
      if (depMode === "iteration") {
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
        }
        return false;
      }
      // barrier mode: downstream waits for foreach completion.
      const foreachState = run.stepStates.find(
        (s) => s.stepId === depId && (s.iteration ?? 0) === 0
      );
      return foreachState?.status === "completed";
    }

    const st = run.stepStates.find(
      s => s.stepId === depId && (s.iteration ?? 0) === iteration
    );

    if (stepPlain?.errorFrom === depId && run?.lastError?.stepId === depId && st?.status === "failed") {
      return true;
    }
    // "skipped" = branch rejected; dependent steps should NOT run
    return st && st.status === "completed";
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

function stringContainsLoopRef(str, loopStepId) {
  if (typeof str !== "string" || !str.includes("{{")) return false;
  const loopRootRegex = /\{\{\s*loop\./;
  if (loopRootRegex.test(str)) return true;
  if (!loopStepId) return false;
  const escaped = String(loopStepId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const loopsRegex = new RegExp(`\\{\\{\\s*loops\\.${escaped}\\.`);
  return loopsRegex.test(str);
}

function valueContainsLoopRef(value, loopStepId) {
  if (typeof value === "string") return stringContainsLoopRef(value, loopStepId);
  if (Array.isArray(value)) return value.some((v) => valueContainsLoopRef(v, loopStepId));
  if (value && typeof value === "object") {
    return Object.values(value).some((v) => valueContainsLoopRef(v, loopStepId));
  }
  return false;
}

function hasDescendantUsingLoopRef(stepId, loopStepId, workflow, visited = new Set()) {
  if (visited.has(stepId)) return false;
  visited.add(stepId);
  const steps = workflow?.steps || [];
  const descendants = steps.filter((s) => Array.isArray(s.dependsOn) && s.dependsOn.includes(stepId));
  for (const desc of descendants) {
    const descPlain = toPlain(desc);
    if (valueContainsLoopRef(descPlain?.params, loopStepId)) return true;
    if (hasDescendantUsingLoopRef(desc.id, loopStepId, workflow, visited)) return true;
  }
  return false;
}

function inferDependencyMode(stepPlain, depId, workflow) {
  const depStep = workflow?.steps?.find((s) => s.id === depId);
  const depType = toPlain(depStep)?.type;
  if (depType !== "foreach") return "barrier";
  if (!stepPlain) return "barrier";
  // If the step or its descendants reference loop context, prefer iteration semantics.
  if (valueContainsLoopRef(stepPlain.params, depId)) return "iteration";
  if (hasDescendantUsingLoopRef(stepPlain.id, depId, workflow)) return "iteration";
  return "barrier";
}

function getDependencyMode({ stepPlain, depId, workflow, dependencyModeCache = null }) {
  const cacheKey = `${stepPlain?.id ?? "_"}::${depId}`;
  if (dependencyModeCache?.has(cacheKey)) return dependencyModeCache.get(cacheKey);
  const explicitModes = stepPlain?.dependencyModes;
  const explicitRaw =
    explicitModes && typeof explicitModes.get === "function"
      ? explicitModes.get(depId)
      : explicitModes?.[depId];
  const explicit = typeof explicitRaw === "string" ? explicitRaw : null;
  const resolved =
    explicit === "iteration" || explicit === "barrier"
      ? explicit
      : inferDependencyMode(stepPlain, depId, workflow);
  if (explicit == null && stepPlain?.id) {
    const warnKey = `${stepPlain.id}->${depId}:${resolved}`;
    if (!inferredDependencyModeWarnings.has(warnKey)) {
      inferredDependencyModeWarnings.add(warnKey);
      logInfo("orchestrator.dependency_mode.inferred", {
        stepId: stepPlain.id,
        dependsOn: depId,
        inferredMode: resolved,
        message: "dependencyModes missing; inferred compatibility mode"
      });
    }
  }
  dependencyModeCache?.set(cacheKey, resolved);
  return resolved;
}

/**
 * True if this step is inside the loop: it depends on loopStepId directly or transitively.
 * Only such steps should use loop iteration; steps like HTTP before the loop must stay at iteration 0.
 */
function isStepInsideLoop(stepId, loopStepId, workflow, dependencyModeCache = null) {
  const steps = workflow.steps || [];
  const visited = new Set();
  function dependsOnLoop(id) {
    if (visited.has(id)) return false;
    visited.add(id);
    const step = steps.find((s) => s.id === id);
    const stepPlain = toPlain(step);
    if (!stepPlain?.dependsOn?.length) return false;
    if (
      stepPlain.dependsOn.includes(loopStepId) &&
      getDependencyMode({
        stepPlain,
        depId: loopStepId,
        workflow,
        dependencyModeCache
      }) === "iteration"
    ) {
      return true;
    }
    return stepPlain.dependsOn.some((depId) => dependsOnLoop(depId));
  }
  return dependsOnLoop(stepId);
}

/**
 * Returns foreach ancestors for a step in outer->inner order.
 * Example: outerForeach -> innerForeach -> taskStep => ["outerForeach", "innerForeach"]
 */
function getForeachAncestorIds(stepId, workflow, cache = null, stack = new Set()) {
  if (!stepId || !workflow?.steps?.length) return [];
  if (cache?.has(stepId)) return cache.get(stepId);
  if (stack.has(stepId)) return [];

  stack.add(stepId);
  const step = workflow.steps.find((s) => s.id === stepId);
  const deps = Array.isArray(step?.dependsOn) ? step.dependsOn : [];
  const ordered = [];

  for (const depId of deps) {
    const depAncestors = getForeachAncestorIds(depId, workflow, cache, stack);
    for (const ancestorId of depAncestors) {
      if (!ordered.includes(ancestorId)) ordered.push(ancestorId);
    }
    const depStep = workflow.steps.find((s) => s.id === depId);
    if (toPlain(depStep)?.type === "foreach" && !ordered.includes(depId)) {
      ordered.push(depId);
    }
  }

  stack.delete(stepId);
  if (cache) cache.set(stepId, ordered);
  return ordered;
}

/**
 * All steps that belong to this loop iteration: direct children of the loop
 * plus any step that depends (transitively) on one of them. We must wait for
 * all of these to complete before advancing the loop so that loopContext
 * (loop.item) is still available when resolving params for steps like email/log.
 */
function isLoopIterationDone(run, loopStepId, iteration, workflow, opts = {}) {
  const steps = workflow.steps || [];
  const continueOnError = opts.continueOnError === true;
  const dependencyModeCache = opts.dependencyModeCache ?? new Map();

  const inIteration = new Set(
    steps
      .map((s) => toPlain(s))
      .filter((s) => s.id !== loopStepId && isStepInsideLoop(s.id, loopStepId, workflow, dependencyModeCache))
      .map((s) => s.id)
  );

  if (!inIteration.size) return true;

  const doneStatuses = continueOnError ? ["completed", "skipped", "failed"] : ["completed", "skipped"];
  for (const stepId of inIteration) {
    const st = run.stepStates.find(
      s => s.stepId === stepId && (s.iteration ?? 0) === iteration
    );
    if (!st) return false;
    if (!doneStatuses.includes(st.status)) return false;
  }
  return true;
}


async function handleIfStepDAG({ workflow, run, stepIndex, iteration = 0, io }) {

  
  const step = workflow.steps[stepIndex];
  const stepId = step.id;

  const conditionExpr = step.params?.condition ?? "";
  const thenGoto = step.params?.thenGoto;
  const elseGoto = step.params?.elseGoto;

  const ctx = buildContext(run, iteration ?? 0, {
    workflow,
    currentStepId: stepId
  });
  const ok = evalCondition(conditionExpr, ctx);

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
  const toEnsure = new Set();
  if (typeof thenGoto === "string" && thenGoto.trim()) toEnsure.add(thenGoto);
  if (typeof elseGoto === "string" && elseGoto.trim()) toEnsure.add(elseGoto);
  if (rejected) {
    const addDescendants = (stepId) => {
      for (const s of workflow.steps || []) {
        const sid = typeof s.id === "string" ? s.id : s?.id;
        if (sid && s.dependsOn?.includes(stepId)) {
          toEnsure.add(sid);
          addDescendants(sid);
        }
      }
    };
    addDescendants(rejected);
  }
  for (const stepId of toEnsure) {
    await ensurePendingStepState({ runId, stepId, iteration: iteration ?? 0 });
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
  const dependencyModeCache = new Map();

  // Control steps (e.g. foreach) are orchestrator-internal and should not consume
  // worker parallel slots; counting them can deadlock low maxParallel workflows.
  const runningCount = run.stepStates.filter((s) => {
    if (!["running", "retrying"].includes(s.status)) return false;
    const stepMeta = workflow.steps.find((wfStep) => wfStep.id === s.stepId);
    const stepType = toPlain(stepMeta)?.type;
    return stepType !== "foreach" && stepType !== "if";
  }).length;
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
        if (isStepInsideLoop(stepPlain.id, run.loopContext.loopStepId, workflow, dependencyModeCache)) {
          const ls = getLoopState(run, run.loopContext.loopStepId);
          iteration = ls?.index ?? run.loopContext?.index ?? 0;
          activeLoopStepIdForDeps = run.loopContext.loopStepId;
        }
      } else {
        const parentLoop = workflow.steps.find((s) => {
          if (s.id === stepPlain.id || s.type !== "foreach") return false;
          if (!stepPlain.dependsOn?.includes(s.id)) return false;
          return (
            getDependencyMode({
              stepPlain,
              depId: s.id,
              workflow,
              dependencyModeCache
            }) === "iteration"
          );
        });

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
            loopId => isStepInsideLoop(stepPlain.id, loopId, workflow, dependencyModeCache)
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

    const isForeachRunning = stepPlain.type === "foreach" && st.status === "running";
    if (st.status !== "pending" && !isForeachRunning) continue;

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

      if (depsSatisfied(run, stepPlain.dependsOn, iteration, activeLoopStepIdForDeps, stepPlain, workflow, dependencyModeCache)) {

        // IF koşulu loop.item ile değerlendiriliyor; loopContext güncel olmalı
        const runForIf = await Run.findById(runId);
        run = runForIf || run;

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
          const selectedState = run.stepStates.find(
            s => s.stepId === selectedStepId && (s.iteration ?? 0) === iteration
          );
          if (selectedState?.status === "skipped") {
            continue;
          }
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

      if (!depsSatisfied(run, stepPlain.dependsOn, 0, null, stepPlain, workflow, dependencyModeCache)) continue;

      let loopState = getLoopState(run, stepPlain.id);
      let items;
      const parallelEnabled = stepPlain.params?.parallel === true;

      /* FIRST ITERATION */

      if (!loopState) {

        const context = buildContext(run, iteration, {
          workflow,
          currentStepId: stepPlain.id,
          activeLoopStepId: run.loopContext?.loopStepId ?? activeLoopStepIdForDeps ?? null
        });
        items = coerceForeachItems(resolveVariables(stepPlain.params?.items, context));
        if (!Array.isArray(items)) {
          const type = items === null ? "null" : Array.isArray(items) ? "array" : typeof items;
          const errMsg = `foreach items must be array (got ${type})`;
          const now = new Date();

          await Run.updateOne(
            {
              _id: runId,
              stepStates: {
                $elemMatch: {
                  stepId: stepPlain.id,
                  iteration: 0,
                  status: { $in: ["pending", "running"] }
                }
              }
            },
            {
              $set: {
                "stepStates.$.status": "failed",
                "stepStates.$.finishedAt": now
              }
            }
          );
          emitStepUpdate(runId, stepPlain.id, 0, "failed", io);

          await Run.updateOne(
            { _id: runId },
            {
              $set: {
                status: "failed",
                finishedAt: now,
                durationMs: now.getTime() - run.createdAt.getTime(),
                lastError: {
                  stepId: stepPlain.id,
                  message: errMsg,
                  iteration: 0
                }
              }
            }
          );

          await dequeueReadyRun(runId);
          await incrMetric("run.failed");

          await addRunLog(
            runId,
            {
              stepId: stepPlain.id,
              message: `[STEP FAIL] ${stepPlain.id}: ${errMsg}`,
              createdAt: now,
              level: "error",
              status: "fail"
            },
            io
          );
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

          const failedRun = await Run.findById(runId);
          emitRunUpdate(failedRun, io);
          await propagateRunFailure({ runId, failedStepId: stepPlain.id, io });
          return;
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

        if (items.length > 0) {
          await Run.updateOne(
            {
              _id: runId,
              stepStates: { $elemMatch: { stepId: stepPlain.id, iteration: 0, status: "pending" } }
            },
            { $set: { "stepStates.$.status": "running" } }
          );
          emitStepUpdate(runId, stepPlain.id, 0, "running", io);
        }

        if (parallelEnabled) {
          const wfMaxParallel = workflow.maxParallel ?? 5;
          // Kickstart scheduling for multiple iterations.
          for (let idx = 0; idx < items.length; idx++) {
            await Run.updateOne(
              { _id: runId },
              {
                $set: {
                  loopContext: {
                    loopStepId: stepPlain.id,
                    index: idx,
                    item: items[idx] ?? null
                  }
                }
              }
            );

            await dispatchReadySteps({ runId, channel, resolveVariables, io });

            const latestRun = await Run.findById(runId);
            const runningCountNow = latestRun?.stepStates?.filter(s => ["running", "retrying"].includes(s.status)).length ?? 0;
            if (runningCountNow >= wfMaxParallel) break;
          }

          return;
        }

        return dispatchReadySteps({ runId, channel, resolveVariables, io });
      }

      items = loopState.items;

      // Parallel foreach mode:
      // - Don't advance loopContext / loopState sequentially.
      // - Keep run.loopContext as-is (it will be updated when individual step results arrive).
      // - Mark the foreach step as completed only when *all* loop iterations have finished.
      if (parallelEnabled) {
        const latestRun = await Run.findById(runId);
        const list = Array.isArray(items) ? items : [];

        const allDone = list.every((_, idx) =>
          isLoopIterationDone(latestRun, stepPlain.id, idx, workflow, { continueOnError: parallelEnabled && (stepPlain.params?.continueOnError !== false) })
        );

        if (allDone) {
          const res = await Run.updateOne(
            {
              _id: runId,
              stepStates: {
                $elemMatch: {
                  stepId: stepPlain.id,
                  iteration: 0,
                  status: { $in: ["pending", "running"] }
                }
              }
            },
            {
              $set: {
                "stepStates.$.status": "completed",
                "stepStates.$.finishedAt": new Date(),
                [`loopState.${stepPlain.id}.index`]: list.length
              },
              $unset: { loopContext: "" }
            }
          );
          if (res.modifiedCount > 0) emitStepUpdate(runId, stepPlain.id, 0, "completed", io);

          return dispatchReadySteps({ runId, channel, resolveVariables, io });
        }

        continue;
      }

      const currentIndex = loopState.index ?? 0;

      /* LOOP FINISHED */

      if (currentIndex >= items.length) {

        const res = await Run.updateOne(
          {
            _id: runId,
            stepStates: {
              $elemMatch: {
                stepId: stepPlain.id,
                iteration: 0,
                status: { $in: ["pending", "running"] }
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
        if (res.modifiedCount > 0) {
          emitStepUpdate(runId, stepPlain.id, 0, "completed", io);
          return dispatchReadySteps({ runId, channel, resolveVariables, io });
        }
      }

      /* ITERATION DONE CHECK */

      const latestRun = await Run.findById(runId);
      if (!latestRun) return;

      const iterationDone = isLoopIterationDone(
        latestRun,
        stepPlain.id,
        currentIndex,
        workflow,
        { continueOnError: stepPlain.params?.continueOnError !== false }
      );
      if (iterationDone) {

        const nextIndex = currentIndex + 1;

        if (nextIndex >= items.length) {
          const res = await Run.updateOne(
            {
              _id: runId,
              stepStates: {
                $elemMatch: {
                  stepId: stepPlain.id,
                  iteration: 0,
                  status: { $in: ["pending", "running"] }
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
          if (res.modifiedCount > 0) emitStepUpdate(runId, stepPlain.id, 0, "completed", io);
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
  stepPlain,
  workflow,
  dependencyModeCache
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
        const refreshed = await Run.findById(runId);
        if (refreshed && isRunDone(workflow, refreshed)) {
          await addRunLog(
            runId,
            { stepId: "system", message: `[RUN] No steps to schedule; run finished`, createdAt: new Date(), level: "system" },
            io
          );
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
          if (completeRes.modifiedCount > 0) {
            await dequeueReadyRun(runId);
            const finalRun = await Run.findById(runId);
            emitRunUpdate(finalRun, io);
            await addRunLog(
              runId,
              { stepId: "system", message: "[RUN COMPLETE] Run completed successfully", createdAt: new Date(), level: "info" },
              io
            );
          }
          return;
        }
        return dispatchReadySteps({ runId, channel, resolveVariables, io });
      }
      return;
    }

  run = await Run.findById(runId) || run;

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

    const stepIteration = item.iteration ?? 0;
    const resolvedParams = resolveVariables(
      stepPlain.params ?? {},
      buildContext(run, stepIteration, {
        workflow,
        currentStepId: stepPlain.id,
        activeLoopStepId: item.loopStepId ?? null
      })
    );

    await persistStepExecutionInput(runId, stepPlain.id, stepIteration, executionId, resolvedParams);

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
        attempt: 0,
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

    const errorPortHandlers = (workflow.steps || []).filter(
      (h) => toPlain(h).errorFrom === s.id
    );
    if (errorPortHandlers.length > 0 && states.some((x) => x.status === "failed")) {
      return errorPortHandlers.every((h) => {
        const hid = toPlain(h).id;
        const hs = run.stepStates.filter((x) => x.stepId === hid);
        if (!hs.length) return false;
        return hs.every((x) =>
          ["completed", "skipped", "failed"].includes(x.status)
        );
      });
    }

    const parentForeach = workflow.steps?.find(
      (wf) => wf.type === "foreach" && isStepInsideLoop(s.id, wf.id, workflow)
    );
    const continueOnError = parentForeach?.params?.continueOnError !== false;
    const doneStatuses = continueOnError ? ["completed", "skipped", "failed"] : ["completed", "skipped"];

    return states.every(x => doneStatuses.includes(x.status));
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
 * run.outputs is keyed by stepId; each value may be iteration-keyed (e.g. { "0": result, "1": result }).
 * When iteration is provided (from loopContext), use that iteration's output.
 */
function getStepOutputForContext(outputs, stepId, iteration = undefined) {
  let raw = outputs instanceof Map ? outputs.get(stepId) : outputs?.[stepId];
  if (raw == null) return undefined;
  if (typeof raw === "object" && !Array.isArray(raw) && raw !== null) {
    const iterKey = iteration != null ? String(iteration) : null;
    const target = iterKey != null
      ? (raw instanceof Map ? raw.get(iterKey) : raw[iterKey])
      : null;
    if (target != null) {
      raw = target;
    } else {
      const entries = raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw);
      const firstNumeric = entries.find(([k]) => String(Number(k)) === k);
      raw = firstNumeric ? (raw instanceof Map ? raw.get(firstNumeric[0]) : raw[firstNumeric[0]]) : (raw instanceof Map ? raw.get("0") : raw["0"]) ?? raw;
    }
  }
  if (raw == null) return undefined;
  if (Array.isArray(raw)) return { output: raw };
  return raw;
}

function buildContext(run, iterationOverride = undefined, options = {}) {
  const { workflow = null, currentStepId = null, activeLoopStepId = null } = options;
  const outputsRaw =
    run.outputs instanceof Map
      ? Object.fromEntries(run.outputs)
      : run.outputs || {};
  const iteration = iterationOverride ?? run.loopContext?.index;

  const stepIds = Object.keys(outputsRaw);
  const steps = {};
  for (const stepId of stepIds) {
    const effective = getStepOutputForContext(
      run.outputs instanceof Map ? run.outputs : outputsRaw,
      stepId,
      iteration
    );
    if (effective !== undefined) steps[stepId] = effective;
  }

  const loopCtx = run.loopContext || {};
  const loops = {};
  let effectiveLoop = loopCtx;

  let ancestorLoopIds = [];
  if (workflow && currentStepId) {
    ancestorLoopIds = getForeachAncestorIds(currentStepId, workflow);
  }
  if (!ancestorLoopIds.length && activeLoopStepId) {
    ancestorLoopIds = [activeLoopStepId];
  }

  for (let i = 0; i < ancestorLoopIds.length; i++) {
    const loopStepId = ancestorLoopIds[i];
    const ls = getLoopState(run, loopStepId);
    if (!ls) continue;
    const isInnermost = i === ancestorLoopIds.length - 1;
    const index = isInnermost && iterationOverride != null
      ? iterationOverride
      : (ls.index ?? 0);
    const item = Array.isArray(ls.items) ? ls.items[index] ?? null : null;
    loops[loopStepId] = { loopStepId, index, item };
  }

  if (ancestorLoopIds.length > 0) {
    const innermostLoopId = ancestorLoopIds[ancestorLoopIds.length - 1];
    effectiveLoop = loops[innermostLoopId] ?? loopCtx;
  } else if (iterationOverride != null && loopCtx.loopStepId) {
    const ls = getLoopState(run, loopCtx.loopStepId);
    const item = Array.isArray(ls?.items) ? ls.items[iterationOverride] ?? null : null;
    effectiveLoop = { ...loopCtx, index: iterationOverride, item };
  }

  return {
    steps,
    run,
    trigger: run.triggerPayload || {},
    env: process.env,
    loop: effectiveLoop,
    loops
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
          retryCount: 0,
          queuedAt: new Date()
        }
      }
    }
  );

  return res.modifiedCount === 1;
}

/**
 * After process death, worker steps can stay running/retrying in Mongo with no step.result.
 * Reset those (except orchestrator-internal foreach/if) to pending so dispatch can resume.
 */
async function normalizeOrphanWorkerStepsForRun(run, io) {
  const wf = run.workflowSnapshot;
  const states = run.stepStates || [];
  if (!wf?.steps?.length || !states.length) return false;

  let resetCount = 0;
  const newStates = states.map((st) => {
    const p = typeof st.toObject === "function" ? st.toObject() : { ...st };
    if (!["running", "retrying"].includes(p.status)) return p;
    const meta = wf.steps.find((s) => toPlain(s).id === p.stepId);
    const typ = meta ? toPlain(meta).type : "";
    if (typ === "foreach" || typ === "if") return p;
    resetCount++;
    return {
      stepId: p.stepId,
      iteration: p.iteration ?? 0,
      retryCount: p.retryCount ?? 0,
      status: "pending"
    };
  });

  if (resetCount === 0) return false;

  const runId = run._id.toString();
  await Run.updateOne({ _id: run._id }, { $set: { stepStates: newStates } });
  await addRunLog(
    runId,
    {
      message: `[RECOVERY] ${resetCount} worker step(s) reset to pending after orchestrator restart`,
      level: "system",
      createdAt: new Date()
    },
    io
  );
  logInfo("orchestrator.crash_recovery.steps_reset", { runId, resetCount });
  const fresh = await Run.findById(run._id);
  if (fresh) emitRunUpdate(fresh, io);
  return true;
}

async function reconcileRunsOnStartup({ io }) {
  const staleRuns = await Run.find({
    status: { $in: ["queued", "running"] }
  }).select({ _id: 1, status: 1, workflowSnapshot: 1, stepStates: 1 }).limit(500);

  for (const run of staleRuns) {
    const runId = run._id.toString();
    if (run.status === "queued") {
      await channel.publish(
        "automation.direct",
        "run.start",
        Buffer.from(JSON.stringify({ runId }))
      );
      continue;
    }

    await normalizeOrphanWorkerStepsForRun(run, io);

    const latest = await Run.findById(runId).select({ _id: 1, status: 1, workflowSnapshot: 1, stepStates: 1 });
    if (!latest || latest.status !== "running") continue;

    const hasSchedulablePending = (latest.stepStates || []).some(
      (s) => s.status === "pending" || s.status === "retrying"
    );
    if (hasSchedulablePending || (latest.workflowSnapshot?.steps?.length ?? 0) > 0) {
      await enqueueReadyRun(runId);
      emitRunUpdate(latest, io);
    }
  }

  await channel.publish(
    "automation.direct",
    "dispatch.kick",
    Buffer.from(JSON.stringify({ t: Date.now(), source: "startup-reconcile" }))
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

    const sourceSteps = version ? version.steps : workflowDoc.steps;
    const snapshot = version
      ? {
          steps: snapshotStepsPlain(sourceSteps),
          maxParallel: version.maxParallel ?? workflowDoc.maxParallel ?? 5,
          onErrorStepId: workflowDoc.onErrorStepId ?? null,
          version: run.workflowVersion
        }
      : {
          steps: snapshotStepsPlain(sourceSteps),
          maxParallel: workflowDoc.maxParallel ?? 5,
          onErrorStepId: workflowDoc.onErrorStepId ?? null,
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
    logError("orchestrator.run_start.error", { message: err?.message || String(err) });
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
    // Keep idempotency list bounded to prevent unbounded run document growth.
    if (PROCESSED_MESSAGES_CAP > 0) {
      await Run.updateOne(
        { _id: runId },
        { $push: { processedMessages: { $each: [], $slice: -PROCESSED_MESSAGES_CAP } } }
      );
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
       : (output?.meta?.durationMs ?? null);
     const attemptInfo = output?.meta?.attempt != null ? ` attempt=${output.meta.attempt}` : "";
     const logEntry = {
       stepId,
       message: `[STEP COMPLETE] ${stepId} iteration=${iteration ?? 0} durationMs=${durationMs ?? "—"}${attemptInfo}`,
       createdAt: new Date(),
      level: "info",
      status: "success",
      durationMs,
      attempt: output?.meta?.attempt,
      error: null
     };
   
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
     await incrMetric("step.success");
   
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
 
    // If this step belongs to a foreach iteration, keep loopContext aligned to
    // that iteration so the scheduler resolves variables and dependency iteration correctly.
    if (loopStepId) {
      const ls = getLoopState(updatedRun, loopStepId);
      const item = Array.isArray(ls?.items) ? ls.items[iteration ?? 0] ?? null : null;
      await Run.updateOne(
        { _id: runId },
        { $set: { loopContext: { loopStepId, index: iteration ?? 0, item } } }
      );
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
       await incrMetric("run.completed");
     
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
      const latest = await Run.findById(runId).select({ stepStates: 1 }).lean();
      const retryBudget = getRunRetryBudget();
      const totalRetry = (latest?.stepStates || []).reduce(
        (acc, s) => acc + (s.retryCount ?? 0),
        0
      );
      const breakerOpen = await isBreakerOpen(step.type);
      if (totalRetry >= retryBudget || breakerOpen) {
        await addRunLog(
          runId,
          {
            stepId,
            message: `[RETRY BLOCKED] budget=${retryBudget} totalRetry=${totalRetry} breakerOpen=${breakerOpen}`,
            createdAt: new Date(),
            level: "warning"
          },
          io
        );
      } else {
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

      const baseDelayMs = typeof step.retryDelay === "number" && step.retryDelay >= 0 ? step.retryDelay : 1000;
      const delayMs = baseDelayMs * Math.pow(2, nextRetry - 1);

      await addRunLog(
        runId,
        {
          stepId,
          message: `[RETRY] ${stepId} attempt=${nextRetry} delay=${delayMs}ms`,
          createdAt: new Date(),
          level: "retry",
          status: "retrying",
          attempt: nextRetry,
          error: typeof error === "string" ? error : String(error ?? "")
        },
        io
      );
      await incrMetric("step.retry");

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

    const errMsg = typeof error === "string" ? error : String(error ?? "");
    const stepFailLog = {
      stepId,
      message: isTimeout ? `[STEP TIMEOUT] ${stepId}: ${errMsg}` : `[STEP FAIL] ${stepId}: ${errMsg}`,
      createdAt: new Date(),
      level: "error",
      status: isTimeout ? "timeout" : "fail",
      durationMs,
      attempt: output?.meta?.attempt
    };

    // DB update: set step to failed first (run status may stay running if error port is used)
    const stepUpdate = {
      $set: {
        "stepStates.$.status": "failed",
        "stepStates.$.finishedAt": finishedAt,
        "stepStates.$.durationMs": durationMs
      }
    };
    stepUpdate.$push = { logs: stepFailLog };

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
    emitRunLog(runId, stepFailLog, io);
    await incrMetric(isTimeout ? "step.timeout" : "step.failed");
    await recordStepFailure(step.type);

    const effectiveIteration = iteration ?? 0;

    // Always expose the failure context for variable resolution in error handlers.
    const message =
      typeof error === "string"
        ? error
        : error != null
          ? JSON.stringify(error)
          : "";
    const lastError = {
      stepId,
      message,
      iteration: effectiveIteration,
      attempt: output?.meta?.attempt
    };
    await Run.updateOne({ _id: runId }, { $set: { lastError } });

    const afterFailLean = await Run.findById(runId).select("workflowSnapshot").lean();
    const snapStepsArr = afterFailLean?.workflowSnapshot?.steps ?? [];
    const wfSnapshot = afterFailLean?.workflowSnapshot;
    const errorHandlerSteps = snapStepsArr.filter(
      (s) => s && String(s.errorFrom) === String(stepId)
    );
    const onErrorStepId = wfSnapshot?.onErrorStepId;

    if (errorHandlerSteps.length > 0) {
      const workflowForSkip = { steps: snapStepsArr };
      const successBranchRoots = snapStepsArr.filter(
        (s) =>
          s &&
          Array.isArray(s.dependsOn) &&
          s.dependsOn.includes(stepId) &&
          String(s.errorFrom) !== String(stepId)
      );
      for (const s of successBranchRoots) {
        await ensurePendingStepState({
          runId,
          stepId: s.id,
          iteration: effectiveIteration
        });
      }
      let runForSkip = await Run.findById(runId);
      for (const s of successBranchRoots) {
        if (!runForSkip) break;
        await skipBranch(workflowForSkip, runId, runForSkip, s.id, effectiveIteration, io);
        runForSkip = await Run.findById(runId);
      }

      const errStepIds = errorHandlerSteps.map(s => s.id);

      const runDoc = await Run.findById(runId);
      const existingIds = new Set(
        (runDoc?.stepStates ?? [])
          .filter(st => st.stepId && (st.iteration ?? 0) === effectiveIteration)
          .map(st => st.stepId)
      );
      const toAdd = errStepIds.filter(id => !existingIds.has(id)).map(id => ({
        stepId: id,
        iteration: effectiveIteration,
        status: "pending",
        retryCount: 0,
        queuedAt: new Date()
      }));
      if (toAdd.length > 0) {
        await Run.updateOne({ _id: runId }, { $push: { stepStates: { $each: toAdd } } });
      } else {
        await Run.updateOne(
          { _id: runId },
          {
            $set: {
              "stepStates.$[s].status": "pending",
              "stepStates.$[s].queuedAt": new Date()
            }
          },
          { arrayFilters: [{ "s.stepId": { $in: errStepIds }, "s.iteration": effectiveIteration }] }
        );
      }
      await enqueueReadyRun(runId);
      if (loopStepId) {
        const ls = getLoopState(run, loopStepId);
        const item = Array.isArray(ls?.items) ? ls.items[effectiveIteration] ?? null : null;
        await Run.updateOne(
          { _id: runId },
          { $set: { loopContext: { loopStepId, index: effectiveIteration, item } } }
        );
      }
      await dispatchReadySteps({ runId, channel, resolveVariables, io });
      await releaseGlobalSlot(globalToken);
      return channel.ack(msg);
    }

    if (typeof onErrorStepId === "string" && onErrorStepId.trim()) {
      const handlerId = onErrorStepId.trim();
      const hasHandler = wfSnapshot?.steps?.some(s => s.id === handlerId);
      if (hasHandler) {
        const runDoc = await Run.findById(runId);
        const existing = (runDoc?.stepStates ?? []).find(
          st => st.stepId === handlerId && (st.iteration ?? 0) === effectiveIteration
        );

        if (!existing) {
          await Run.updateOne({
            _id: runId
          }, {
            $push: {
              stepStates: {
                stepId: handlerId,
                iteration: effectiveIteration,
                status: "pending",
                retryCount: 0,
                queuedAt: new Date()
              }
            }
          });
        } else {
          await Run.updateOne(
            { _id: runId },
            {
              $set: {
                "stepStates.$[s].status": "pending",
                "stepStates.$[s].queuedAt": new Date()
              }
            },
            { arrayFilters: [{ "s.stepId": handlerId, "s.iteration": effectiveIteration }] }
          );
        }

        await enqueueReadyRun(runId);
        if (loopStepId) {
          const ls = getLoopState(run, loopStepId);
          const item = Array.isArray(ls?.items) ? ls.items[effectiveIteration] ?? null : null;
          await Run.updateOne(
            { _id: runId },
            { $set: { loopContext: { loopStepId, index: effectiveIteration, item } } }
          );
        }
        await dispatchReadySteps({ runId, channel, resolveVariables, io });
        await releaseGlobalSlot(globalToken);
        return channel.ack(msg);
      }
    }

    /* ================= FOREACH CONTINUE ON ERROR ================= */
    if (loopStepId) {
      const foreachStep = wfSnapshot?.steps?.find(s => s.id === loopStepId);
      const continueOnError = foreachStep?.params?.continueOnError !== false;
      const parallelEnabled = foreachStep?.params?.parallel === true;
      if (continueOnError) {
        await addRunLog(
          runId,
          {
            stepId: loopStepId,
            message: `[FOREACH] Step ${stepId} failed in iteration ${effectiveIteration}; continuing (continueOnError)`,
            createdAt: new Date(),
            level: "warning"
          },
          io
        );

        if (!parallelEnabled) {
          const ls = getLoopState(run, loopStepId);
          const items = Array.isArray(ls?.items) ? ls.items : [];
          const nextIndex = effectiveIteration + 1;

          if (nextIndex >= items.length) {
            await Run.updateOne(
              {
                _id: runId,
                stepStates: { $elemMatch: { stepId: loopStepId, iteration: 0, status: { $in: ["pending", "running"] } } }
              },
              {
                $set: {
                  "stepStates.$.status": "completed",
                  "stepStates.$.finishedAt": new Date(),
                  [`loopState.${loopStepId}.index`]: items.length
                },
                $unset: { loopContext: "" }
              }
            );
            emitStepUpdate(runId, loopStepId, 0, "completed", io);
          } else {
            const nextItem = items[nextIndex] ?? null;
            await Run.updateOne(
              { _id: runId },
              {
                $set: {
                  loopContext: { loopStepId, index: nextIndex, item: nextItem },
                  [`loopState.${loopStepId}.index`]: nextIndex
                }
              }
            );
          }
        }

        await dispatchReadySteps({ runId, channel, resolveVariables, io });
        await releaseGlobalSlot(globalToken);
        return channel.ack(msg);
      }
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
    await incrMetric("run.failed");

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
    logError("orchestrator.step_result.error", { message: err?.message || String(err) });
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
    await incrMetric("run.cancelled");

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
    logError("orchestrator.run_cancel.error", { message: err?.message || String(err) });
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
    const resolvedParams = resolveVariables(
      stepPlain.params ?? {},
      buildContext(updatedRun, iteration, {
        workflow: updatedRun?.workflowSnapshot ?? null,
        currentStepId: stepPlain.id,
        activeLoopStepId: loopStepId ?? null
      })
    );

    await persistStepExecutionInput(runId, stepPlain.id, iteration, executionId, resolvedParams);

    await addRunLog(
      runId,
      {
        stepId: stepPlain.id,
        message: `[RETRY] ${stepPlain.id} attempt=${retryCount} executing`,
        level: "retry",
        createdAt: new Date(),
        status: "retrying",
        attempt: retryCount,
        error: null
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
        attempt: retryCount,
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
          iteration
        })),
        { expiration: String(stepPlain.timeout), persistent: true }
      );
    }

    return channel.ack(msg);

  } catch (err) {
    logError("orchestrator.retry_fire.error", { message: err?.message || String(err) });
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

    // The worker will publish `step.result` after this cancellation.
    // Retry/fail decision is handled in the `step.result.q` consumer (single source of truth).
    await addRunLog(
      runId,
      {
        stepId,
        message: `[STEP TIMEOUT SIGNAL] executionId=${executionId} iteration=${iteration}`,
        createdAt: new Date(),
        level: "warning"
      },
      io
    );
    await releaseGlobalSlot(globalToken);
    return channel.ack(msg);
    } catch (err) {
    logError("orchestrator.timeout_handler.error", { message: err?.message || String(err) });
    channel.nack(msg, false, true);
    }
  });



  await channel.consume("dispatch.kick.q", async (msg) => {
    if (!msg) return;
    try {
      await pumpReadyRuns({ io });
      channel.ack(msg);
    } catch (e) {
      logError("orchestrator.dispatch_kick.error", { message: e?.message || String(e) });
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
      logError("orchestrator.workflow_created_event.error", { message: err?.message || String(err) });
      channel.nack(msg, false, true);
    }
  });
  
  await reconcileRunsOnStartup({ io });

  setInterval(() => {
    pumpReadyRuns({ io }).catch((e) => logError("orchestrator.pump_tick.error", { message: e?.message || String(e) }));
  }, 1000);
  logInfo("orchestrator.start", { message: "Orchestrator running (enterprise mode)" });
}

export const __test__ = {
  depsSatisfied,
  getDependencyMode,
  inferDependencyMode,
  isStepInsideLoop,
};
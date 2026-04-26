import express from "express";
import { channel } from "../config/rabbit.js";
import { createReplayRun } from "../utils/runReplay.js";
import { getPlatformModels } from "../utils/tenantModels.js";

const router = express.Router();
const modelsOf = () => getPlatformModels();
const ownedRunQuery = (req, id) => ({ _id: id, userId: req.user.id });
const detailDebugCounts = new Map();

/** Mongoose Map in .lean() may be a plain object; support both. */
function leanMapToRecord(value) {
  if (value == null) return {};
  if (typeof value.entries === "function") {
    return Object.fromEntries(value.entries());
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ...value };
  }
  return {};
}

function normalizeStepForDetail(step) {
  return {
    id: step.id,
    type: step.type,
    retry: step.retry,
    retryDelay: step.retryDelay,
    timeout: step.timeout,
    dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
    dependencyModes: leanMapToRecord(step.dependencyModes),
    branch: step.branch,
    errorFrom: step.errorFrom,
    disabled: Boolean(step.disabled),
    params: step.params || {},
  };
}

function debugRunDetailTopology(runId, payload) {
  if (process.env.NODE_ENV === "production") return;
  const key = String(runId);
  const nextCount = (detailDebugCounts.get(key) ?? 0) + 1;
  if (nextCount > 60) return;
  detailDebugCounts.set(key, nextCount);
  console.log("[RunDetailTopologyDebug]", {
    runId: key,
    emit: nextCount,
    ...payload,
  });
}

router.post("/:id/replay", async (req, res) => {
  try {
    const { Run } = modelsOf(req);
    const runId = req.params.id;
    const fromStepId = req.body?.fromStepId;
    const iteration = req.body?.iteration;
    if (!fromStepId || typeof fromStepId !== "string") {
      return res.status(400).json({ error: "fromStepId (string) required" });
    }
    if (iteration != null && (!Number.isInteger(Number(iteration)) || Number(iteration) < 0)) {
      return res.status(400).json({ error: "iteration must be a non-negative integer" });
    }

    const sourceRun = await Run.findOne(ownedRunQuery(req, runId)).lean();
    if (!sourceRun) return res.status(404).json({ error: "Run not found" });

    const terminal = ["completed", "failed", "cancelled"].includes(sourceRun.status);
    if (!terminal) {
      return res.status(400).json({ error: "Run must be completed, failed, or cancelled to replay" });
    }

    const steps = sourceRun.workflowSnapshot?.steps ?? [];
    const stepIds = new Set(steps.map((s) => s.id));
    if (!stepIds.has(fromStepId)) {
      return res.status(400).json({ error: "fromStepId not found in workflow snapshot" });
    }

    const payload = createReplayRun(
      sourceRun,
      fromStepId,
      iteration != null ? Number(iteration) : undefined
    );
    const newRun = await Run.create({ ...payload, userId: req.user.id });

    await channel.publish(
      "automation.direct",
      "run.start",
      Buffer.from(JSON.stringify({ runId: newRun._id.toString() }))
    );

    return res.status(201).json({ runId: newRun._id.toString(), message: "Replay started" });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

router.get("/:id/summary", async (req, res) => {
  try {
    const { Run } = modelsOf(req);
    const run = await Run.findOne(ownedRunQuery(req, req.params.id));

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
    const { Run } = modelsOf(req);
    const run = await Run.findOne(ownedRunQuery(req, req.params.id))
      .populate("workflowId", "name")
      .lean();

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    const { workflowId, ...rest } = run;
    const result = {
      ...rest,
      workflow: workflowId
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const { Run } = modelsOf(req);
    const runs = await Run.find({ userId: req.user.id })
      .select({
        status: 1,
        currentStepIndex: 1,
        finishedAt: 1,
        durationMs: 1,
        stepStates: 1,
        createdAt: 1
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/cancel", async (req, res) => {
  try {
    const { Run } = modelsOf(req);
    const runId = req.params.id;
    const run = await Run.findOne(ownedRunQuery(req, runId)).select({ _id: 1 }).lean();
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    await channel.sendToQueue(
      "run.cancel.q",
      Buffer.from(
        JSON.stringify({
          runId,
          reason: req.body?.reason || "User cancelled"
        })
      ),
      { persistent: true }
    );

    res.json({ message: "Cancel requested", runId: run._id.toString() });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get detailed run information for debugger / inspector views.
 * Includes stepStates, outputs, and basic workflow snapshot.
 */
router.get("/:id/detail", async (req, res) => {
  try {
    const { Run, Workflow, TelegramEvent } = modelsOf(req);
    const runId = req.params.id;
    const run = await Run.findOne(ownedRunQuery(req, runId)).lean();
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }
    let topologySteps = Array.isArray(run.workflowSnapshot?.steps) ? run.workflowSnapshot.steps : [];
    let topologySource = "workflowSnapshot";
    if (!topologySteps.length) {
      topologySource = "workflowDoc";
      const workflowDoc = await Workflow.findOne({ _id: run.workflowId, userId: req.user.id })
        .select({ currentVersion: 1, versions: 1, steps: 1 })
        .lean();
      if (workflowDoc) {
        const versionMatch = Array.isArray(workflowDoc.versions)
          ? workflowDoc.versions.find((ver) => ver.version === run.workflowVersion)
          : null;
        if (versionMatch?.steps?.length) {
          topologySource = "workflowDoc.version";
          topologySteps = versionMatch.steps;
        } else {
          topologySource = "workflowDoc.current";
          topologySteps = Array.isArray(workflowDoc.steps) ? workflowDoc.steps : [];
        }
      }
    }
    const steps = topologySteps.map(normalizeStepForDetail);
    debugRunDetailTopology(runId, {
      status: run.status,
      workflowVersion: run.workflowVersion,
      source: topologySource,
      stepCount: steps.length,
      stepStateCount: Array.isArray(run.stepStates) ? run.stepStates.length : 0,
      logsCount: Array.isArray(run.logs) ? run.logs.length : 0,
    });

    const stepStates = (run.stepStates || []).map((st) => ({
      stepId: st.stepId,
      iteration: st.iteration ?? 0,
      status: st.status,
      startedAt: st.startedAt,
      finishedAt: st.finishedAt,
      durationMs: st.durationMs,
      retryCount: st.retryCount,
      executionId: st.executionId,
    }));

    const outputs = leanMapToRecord(run.outputs);

    const logs = (run.logs || []).map((l) => ({
      stepId: l.stepId,
      message: l.message,
      level: l.level || "info",
      status: l.status,
      durationMs: l.durationMs,
      attempt: l.attempt,
      error: l.error,
      createdAt: l.createdAt,
    }));

    const stepInputs = leanMapToRecord(run.stepInputs);

    const telegramEvents = await TelegramEvent.find({
      userId: req.user.id,
      runId
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json({
      id: run._id.toString(),
      workflowId: run.workflowId?.toString(),
      status: run.status,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      workflowVersion: run.workflowVersion,
      topologySource,
      steps,
      stepStates,
      outputs,
      logs,
      loopContext: run.loopContext || null,
      lastError: run.lastError || null,
      stepInputs,
      telegramEvents,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get detailed information for a specific step (and optional iteration) in a run.
 * GET /runs/:id/steps/:stepId/:iteration?
 */
router.get("/:id/steps/:stepId/:iteration?", async (req, res) => {
  try {
    const { Run } = modelsOf(req);
    const { id, stepId } = req.params;
    const iterationParam = req.params.iteration;
    const iteration = iterationParam !== undefined ? Number(iterationParam) : undefined;

    const run = await Run.findOne(ownedRunQuery(req, id)).lean();
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    const steps = run.workflowSnapshot?.steps || [];
    const stepMeta = steps.find((s) => s.id === stepId);
    if (!stepMeta) {
      return res.status(404).json({ error: "Step not found in workflow snapshot" });
    }

    const allStates = (run.stepStates || []).filter((st) => st.stepId === stepId);
    if (!allStates.length) {
      return res.status(404).json({ error: "No step state found for this step" });
    }

    let state = allStates[allStates.length - 1];
    if (iteration !== undefined && !Number.isNaN(iteration)) {
      const match = allStates.find((st) => (st.iteration ?? 0) === iteration);
      if (match) state = match;
    }

    let output = undefined;
    if (run.outputs && run.outputs instanceof Map) {
      const stepOutput = run.outputs.get(stepId);
      if (stepOutput != null && typeof stepOutput === "object") {
        const key = String(state.iteration ?? 0);
        output = stepOutput[key] ?? stepOutput;
      } else {
        output = stepOutput;
      }
    } else if (run.outputs && typeof run.outputs === "object") {
      const stepOutput = run.outputs[stepId];
      if (stepOutput != null && typeof stepOutput === "object") {
        const key = String(state.iteration ?? 0);
        output = stepOutput[key] ?? stepOutput;
      } else {
        output = stepOutput;
      }
    }

    res.json({
      step: {
        id: stepMeta.id,
        type: stepMeta.type,
        retry: stepMeta.retry,
        timeout: stepMeta.timeout,
        dependsOn: stepMeta.dependsOn || [],
        disabled: stepMeta.disabled || false,
      },
      state: {
        stepId: state.stepId,
        iteration: state.iteration ?? 0,
        status: state.status,
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
        durationMs: state.durationMs,
        retryCount: state.retryCount,
        executionId: state.executionId,
      },
      output,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
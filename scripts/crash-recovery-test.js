/**
 * Verifies crash-recovery helpers stay consistent with orchestrator.js:
 * hasWorkerInflightStepStates + normalize stepStates mapping.
 * Usage: node scripts/crash-recovery-test.js
 */
import assert from "node:assert";

function toPlain(stepDoc) {
  return typeof stepDoc?.toObject === "function" ? stepDoc.toObject() : stepDoc;
}

/** Keep in sync with apps/api/src/engine/orchestrator.js */
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

/** Keep in sync with normalizeOrphanWorkerStepsForRun mapping */
function buildNormalizedStates(wf, states) {
  let resetCount = 0;
  const newStates = states.map((p) => {
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
  return { newStates, resetCount };
}

function run() {
  const wf = {
    steps: [
      { id: "http_a", type: "http" },
      { id: "loop", type: "foreach" },
      { id: "branch", type: "if" }
    ]
  };

  assert.strictEqual(
    hasWorkerInflightStepStates([{ stepId: "http_a", status: "running" }], wf),
    true,
    "plugin running counts as worker inflight"
  );
  assert.strictEqual(
    hasWorkerInflightStepStates([{ stepId: "loop", status: "running" }], wf),
    false,
    "foreach running must not count as worker inflight"
  );
  assert.strictEqual(
    hasWorkerInflightStepStates([{ stepId: "branch", status: "retrying" }], wf),
    false,
    "if retrying must not count as worker inflight"
  );
  assert.strictEqual(
    hasWorkerInflightStepStates(
      [
        { stepId: "loop", status: "running" },
        { stepId: "http_a", status: "pending" }
      ],
      wf
    ),
    false,
    "only zombie foreach + pending → no worker inflight for dequeue guard"
  );
  assert.strictEqual(
    hasWorkerInflightStepStates(
      [{ stepId: "http_a", status: "running" }],
      { steps: [] }
    ),
    false
  );

  const { newStates, resetCount } = buildNormalizedStates(wf, [
    { stepId: "http_a", iteration: 0, status: "running", executionId: "x", retryCount: 1 },
    { stepId: "loop", iteration: 0, status: "running", retryCount: 0 }
  ]);
  assert.strictEqual(resetCount, 1);
  assert.strictEqual(newStates[0].status, "pending");
  assert.strictEqual(newStates[0].executionId, undefined);
  assert.strictEqual(newStates[1].status, "running");

  console.log("[OK] crash-recovery-test: assertions passed");
}

run();

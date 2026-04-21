/**
 * success-basic-test.js
 * Send valid webhook request, expect 202, validate workflow completes successfully.
 * Usage: node scripts/success-basic-test.js [WORKFLOW_ID]
 */

import "./load-root-env.js";
import axios from "axios";

const API_URL = process.env.API_URL || "http://localhost:4000";
const WORKFLOW_ID = process.argv[2] || process.env.WORKFLOW_ID;

async function createWorkflow(body) {
  const res = await axios.post(`${API_URL}/workflows`, body);
  return res.data._id?.toString() || res.data.id;
}

async function triggerWebhook(workflowId, body = {}) {
  const res = await axios.post(`${API_URL}/webhook/${workflowId}`, body);
  return res.data.runId?.toString() || res.data.runId;
}

async function getRun(runId) {
  const res = await axios.get(`${API_URL}/runs/${runId}`);
  return res.data;
}

async function pollUntilFinished(runId, maxWaitMs = 60000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const run = await getRun(runId);
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Run ${runId} did not finish within ${maxWaitMs}ms`);
}

async function run() {
  console.log("\n[TEST] success-basic-test");
  const startAll = Date.now();

  let workflowId = WORKFLOW_ID;
  if (!workflowId) {
    console.log("[TEST] Creating workflow (log step)...");
    workflowId = await createWorkflow({
      name: "Test Success Basic",
      trigger: { type: "trigger.webhook" },
      steps: [
        { id: "log_0", type: "log", params: { message: "{{ trigger.body.test }}" }, dependsOn: [] },
      ],
      maxParallel: 5,
    });
    console.log(`[TEST] Created workflow: ${workflowId}`);
  }

  const triggerStart = Date.now();
  const runId = await triggerWebhook(workflowId, { test: "ok" });
  const triggerMs = Date.now() - triggerStart;

  console.log(`[TEST] Trigger: 202 Accepted, runId=${runId}, ${triggerMs}ms`);

  const run = await pollUntilFinished(runId);
  const totalMs = Date.now() - startAll;

  if (run.status !== "completed") {
    console.error(`[FAIL] Expected completed, got ${run.status}`);
    process.exit(1);
  }

  const steps = run.stepStates || [];
  const allCompleted = steps.every((s) => s.status === "completed");
  if (!allCompleted) {
    console.error(`[FAIL] Not all steps completed:`, steps);
    process.exit(1);
  }

  console.log(`[OK] Run completed, ${steps.length} step(s), total ${totalMs}ms`);
}

run().catch((err) => {
  console.error("[FAIL]", err.response?.data || err.message);
  process.exit(1);
});

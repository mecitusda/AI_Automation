/**
 * cancel-test.js
 * Trigger workflow, send cancel message. Expect: Run cancelled, steps aborted.
 * Usage: node scripts/cancel-test.js [WORKFLOW_ID]
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

async function cancelRun(runId) {
  const res = await axios.post(`${API_URL}/runs/${runId}/cancel`, { reason: "Test cancel" });
  return res.data;
}

async function getRun(runId) {
  const res = await axios.get(`${API_URL}/runs/${runId}`);
  return res.data;
}

async function pollUntilFinished(runId, maxWaitMs = 15000, intervalMs = 300) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const run = await getRun(runId);
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Run ${runId} did not finish within ${maxWaitMs}ms`);
}

async function run() {
  console.log("\n[TEST] cancel-test");
  const startAll = Date.now();

  let workflowId = WORKFLOW_ID;
  if (!workflowId) {
    console.log("[TEST] Creating workflow (long delay step)...");
    workflowId = await createWorkflow({
      name: "Test Cancel",
      trigger: { type: "trigger.webhook" },
      steps: [
        {
          id: "delayStep",
          type: "delay",
          params: { ms: 30000 },
          dependsOn: [],
        },
      ],
      maxParallel: 5,
    });
    console.log(`[TEST] Created workflow: ${workflowId}`);
  }

  const runId = await triggerWebhook(workflowId, { test: "cancel" });
  console.log(`[TEST] Run started: ${runId}`);

  await new Promise((r) => setTimeout(r, 500));

  const cancelStart = Date.now();
  await cancelRun(runId);
  const cancelMs = Date.now() - cancelStart;
  console.log(`[TEST] Cancel requested, ${cancelMs}ms`);

  const run = await pollUntilFinished(runId);
  const totalMs = Date.now() - startAll;

  if (run.status !== "cancelled") {
    console.error(`[FAIL] Expected cancelled, got ${run.status}`);
    process.exit(1);
  }

  console.log(`[OK] Run cancelled, total ${totalMs}ms`);
}

run().catch((err) => {
  console.error("[FAIL]", err.response?.data || err.message);
  process.exit(1);
});

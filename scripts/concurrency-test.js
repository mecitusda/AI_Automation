/**
 * concurrency-test.js
 * Send parallel requests. Validate no crashes, no memory explosion.
 * Usage: node scripts/concurrency-test.js [WORKFLOW_ID]
 */

import "./load-root-env.js";
import axios from "axios";

const API_URL = process.env.API_URL || "http://localhost:4000";
const WORKFLOW_ID = process.argv[2] || process.env.WORKFLOW_ID;
const CONCURRENT = 5;

async function createWorkflow(body) {
  const res = await axios.post(`${API_URL}/workflows`, body);
  return res.data._id?.toString() || res.data.id;
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

async function singleRequest(workflowId, i) {
  const start = Date.now();
  try {
    const res = await axios.post(`${API_URL}/webhook/${workflowId}`, { test: i });
    const triggerMs = Date.now() - start;
    const runId = res.data?.runId;
    if (!runId) return { i, status: res.status, error: "No runId", ok: false };
    const run = await pollUntilFinished(runId);
    const totalMs = Date.now() - start;
    return { i, status: res.status, runId, runStatus: run.status, triggerMs, totalMs, ok: res.status === 202 };
  } catch (err) {
    return { i, status: 0, error: err.message, ok: false };
  }
}

async function run() {
  console.log("\n[TEST] concurrency-test - 5 parallel requests");
  const startAll = Date.now();

  let workflowId = WORKFLOW_ID;
  if (!workflowId) {
    console.log("[TEST] Creating workflow...");
    workflowId = await createWorkflow({
      name: "Test Concurrency",
      trigger: { type: "trigger.webhook" },
      steps: [
        { id: "log_0", type: "log", params: { message: "{{ trigger.body.test }}" }, dependsOn: [] },
      ],
      maxParallel: 5,
    });
    console.log(`[TEST] Created workflow: ${workflowId}`);
  }

  const memBefore = process.memoryUsage();
  const promises = Array.from({ length: CONCURRENT }, (_, i) => singleRequest(workflowId, i));
  const results = await Promise.all(promises);
  const memAfter = process.memoryUsage();

  const totalMs = Date.now() - startAll;
  const success = results.filter((r) => r.ok && r.status === 202).length;
  const errors = results.filter((r) => !r.ok).length;
  const completed = results.filter((r) => r.runStatus === "completed").length;
  const avgTrigger = results.reduce((a, r) => a + (r.triggerMs || 0), 0) / results.length;

  console.log("\n--- Results ---");
  console.log(`Total: ${CONCURRENT} requests in ${totalMs}ms`);
  console.log(`  202 Accepted: ${success}`);
  console.log(`  Runs completed: ${completed}`);
  console.log(`  Avg trigger time: ${avgTrigger.toFixed(0)}ms`);
  if (errors > 0) console.log(`  Errors: ${errors}`);

  const heapDelta = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
  console.log(`Memory delta: ${heapDelta >= 0 ? "+" : ""}${heapDelta.toFixed(2)} MB`);

  if (errors > 0) {
    console.error(`[FAIL] ${errors} requests failed`);
    process.exit(1);
  }

  if (Math.abs(heapDelta) > 100) {
    console.error(`[FAIL] Large memory delta: ${heapDelta.toFixed(2)} MB`);
    process.exit(1);
  }

  console.log(`[OK] No crashes, memory stable`);
}

run().catch((err) => {
  console.error("[FAIL]", err.response?.data || err.message);
  process.exit(1);
});

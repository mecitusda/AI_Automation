/**
 * large-payload-test.js
 * Send large JSON body (500 items, ~45KB). Ensure system handles it.
 * Note: Default Express limit is 100KB; use 500 items to stay under.
 * Usage: node scripts/large-payload-test.js [WORKFLOW_ID]
 */

import "./load-root-env.js";
import axios from "axios";

const API_URL = process.env.API_URL || "http://localhost:4000";
const WORKFLOW_ID = process.argv[2] || process.env.WORKFLOW_ID;
const ITEM_COUNT = 500;

async function createWorkflow(body) {
  const res = await axios.post(`${API_URL}/workflows`, body);
  return res.data._id?.toString() || res.data.id;
}

async function getRun(runId) {
  const res = await axios.get(`${API_URL}/runs/${runId}`);
  return res.data;
}

async function pollUntilFinished(runId, maxWaitMs = 120000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const run = await getRun(runId);
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Run ${runId} did not finish within ${maxWaitMs}ms`);
}

async function run() {
  console.log("\n[TEST] large-payload-test");
  const startAll = Date.now();

  let workflowId = WORKFLOW_ID;
  if (!workflowId) {
    console.log("[TEST] Creating workflow (log step with trigger.body)...");
    workflowId = await createWorkflow({
      name: "Test Large Payload",
      trigger: { type: "trigger.webhook" },
      steps: [
        { id: "log_0", type: "log", params: { message: "Received {{ trigger.body.items.length }} items" }, dependsOn: [] },
      ],
      maxParallel: 5,
    });
    console.log(`[TEST] Created workflow: ${workflowId}`);
  }

  const body = {
    items: Array.from({ length: ITEM_COUNT }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      data: "x".repeat(50),
    })),
  };
  const payloadSize = JSON.stringify(body).length;
  console.log(`[TEST] Payload size: ${(payloadSize / 1024).toFixed(1)} KB (${ITEM_COUNT} items)`);

  const triggerStart = Date.now();
  const res = await axios.post(`${API_URL}/webhook/${workflowId}`, body);
  const triggerMs = Date.now() - triggerStart;

  if (res.status !== 202) {
    console.error(`[FAIL] Expected 202, got ${res.status}`);
    process.exit(1);
  }

  const runId = res.data?.runId;
  if (!runId) {
    console.error(`[FAIL] No runId in response`);
    process.exit(1);
  }

  const run = await pollUntilFinished(runId);
  const totalMs = Date.now() - startAll;

  if (run.status !== "completed") {
    console.error(`[FAIL] Expected completed, got ${run.status}`);
    process.exit(1);
  }

  console.log(`[OK] Run completed, payload ${(payloadSize / 1024).toFixed(1)} KB, total ${totalMs}ms`);
}

run().catch((err) => {
  console.error("[FAIL]", err.response?.data || err.message);
  process.exit(1);
});

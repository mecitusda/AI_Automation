/**
 * rate-limit-test.js
 * Send 100 concurrent webhook requests.
 * Expect: Some 429 responses, system stays stable.
 * Usage: node scripts/rate-limit-test.js <WORKFLOW_ID>
 */

import "./load-root-env.js";
import axios from "axios";

const API_URL = process.env.API_URL || "http://localhost:4000";
const WORKFLOW_ID = process.argv[2] || process.env.WORKFLOW_ID;
const CONCURRENT = 100;

async function createWorkflow(body) {
  const res = await axios.post(`${API_URL}/workflows`, body);
  return res.data._id?.toString() || res.data.id;
}

function randomPayments(count = 3) {
  const emails = ["user1@test.com", "user2@test.com", "premium@test.com"];
  return Array.from({ length: count }, () => ({
    amount: Math.floor(Math.random() * 3000) + 100,
    email: emails[Math.floor(Math.random() * emails.length)],
  }));
}

async function singleRequest(workflowId, i) {
  const start = Date.now();
  const body = { payments: randomPayments(2 + (i % 4)) };
  try {
    const res = await axios.post(`${API_URL}/webhook/${workflowId}`, body, {
      validateStatus: () => true,
    });
    const duration = Date.now() - start;
    return { i, status: res.status, duration, ok: res.status >= 200 && res.status < 300 };
  } catch (err) {
    return { i, status: 0, error: err.message, ok: false };
  }
}

async function run() {
  let workflowId = WORKFLOW_ID;
  if (!workflowId) {
    console.log("[TEST] Creating workflow...");
    workflowId = await createWorkflow({
      name: "Test Rate Limit",
      trigger: { type: "trigger.webhook" },
      steps: [
        { id: "log_0", type: "log", params: { message: "{{ trigger.body }}" }, dependsOn: [] },
      ],
      maxParallel: 5,
    });
    console.log(`[TEST] Created workflow: ${workflowId}`);
  }

  console.log("\n[TEST] rate-limit-test - 100 concurrent requests");
  const url = `${API_URL}/webhook/${workflowId}`;
  console.log(`[TEST] URL: ${url}`);

  const memBefore = process.memoryUsage();
  const startAll = Date.now();

  const promises = Array.from({ length: CONCURRENT }, (_, i) => singleRequest(workflowId, i));
  const results = await Promise.all(promises);

  const durationAll = Date.now() - startAll;
  const memAfter = process.memoryUsage();

  const byStatus = {};
  results.forEach((r) => {
    const s = r.status || "error";
    byStatus[s] = (byStatus[s] || 0) + 1;
  });

  const success = results.filter((r) => r.status === 202).length;
  const rateLimited = results.filter((r) => r.status === 429).length;
  const errors = results.filter((r) => !r.ok && r.status !== 429).length;

  console.log("\n--- Results ---");
  console.log(`Total: ${CONCURRENT} requests in ${durationAll}ms`);
  console.log(`  202 Accepted: ${success}`);
  console.log(`  429 Rate limited: ${rateLimited}`);
  if (errors > 0) console.log(`  Errors: ${errors}`);
  console.log(`Status breakdown:`, byStatus);

  const heapDelta = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
  console.log(`\nMemory delta: ${heapDelta >= 0 ? "+" : ""}${heapDelta.toFixed(2)} MB`);

  if (errors > 0) {
    console.error(`[FAIL] ${errors} requests failed`);
    process.exit(1);
  }

  console.log(`[OK] System stable, rate limit working (${rateLimited} x 429)`);
}

run().catch((err) => {
  console.error("[FAIL]", err.response?.data || err.message);
  process.exit(1);
});

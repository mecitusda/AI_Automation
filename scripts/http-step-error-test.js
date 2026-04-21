/**
 * Expects an HTTP step against a URL that returns 4xx; run should fail with a detailed message (not generic "Step failed").
 * Usage: node scripts/http-step-error-test.js [WORKFLOW_ID]
 * Requires API + infra (same as success-basic-test). AUTH: unset JWT or AUTH_REQUIRED=false for unauthenticated workflow create.
 */

import "./load-root-env.js";
import axios from "axios";

const API_URL = process.env.API_URL || "http://localhost:4000";
const WORKFLOW_ID = process.argv[2] || process.env.WORKFLOW_ID;

async function createWorkflow(body) {
  const res = await axios.post(`${API_URL}/workflows`, body);
  return res.data._id?.toString() || res.data.id;
}

async function triggerWebhook(workflowId) {
  const res = await axios.post(`${API_URL}/webhook/${workflowId}`, {});
  return res.data.runId?.toString() || res.data.runId;
}

async function getRun(runId) {
  const res = await axios.get(`${API_URL}/runs/${runId}`);
  return res.data;
}

async function pollUntilFinished(runId, maxWaitMs = 60000, intervalMs = 400) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const run = await getRun(runId);
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Run ${runId} did not finish within ${maxWaitMs}ms`);
}

async function run() {
  console.log("\n[TEST] http-step-error-test");

  let workflowId = WORKFLOW_ID;
  if (!workflowId) {
    const missingUrl = `${API_URL}/__path_that_should_404__${Date.now()}`;
    workflowId = await createWorkflow({
      name: "Test HTTP 404",
      trigger: { type: "trigger.webhook" },
      steps: [
        {
          id: "http_1",
          type: "http",
          params: { url: missingUrl, method: "GET" },
          dependsOn: [],
        },
      ],
      maxParallel: 5,
    });
    console.log(`[TEST] Created workflow: ${workflowId}`);
  }

  const runId = await triggerWebhook(workflowId);
  console.log(`[TEST] runId=${runId}`);

  const finished = await pollUntilFinished(runId);
  if (finished.status !== "failed") {
    console.error(`[FAIL] Expected failed, got ${finished.status}`);
    process.exit(1);
  }

  const logs = finished.logs || [];
  const failLog = [...logs].reverse().find((l) => l.message?.includes("[STEP FAIL]") || l.level === "error");
  const haystack = [
    failLog?.message,
    failLog?.error,
    finished.lastError?.message,
  ]
    .filter(Boolean)
    .join(" ");

  if (haystack.includes("Step failed") && !haystack.match(/HTTP\s+(4|5)\d\d/)) {
    console.error("[FAIL] Still generic Step failed without HTTP status:", haystack.slice(0, 500));
    process.exit(1);
  }
  if (!/HTTP\s+404/i.test(haystack)) {
    console.error("[FAIL] Expected HTTP 404 in failure text, got:", haystack.slice(0, 500));
    process.exit(1);
  }

  console.log("[OK] Failure message includes HTTP status:", haystack.slice(0, 200));
}

run().catch((err) => {
  console.error("[FAIL]", err.response?.data || err.message);
  process.exit(1);
});

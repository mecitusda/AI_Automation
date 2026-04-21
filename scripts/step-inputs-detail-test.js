/**
 * Integration: after a successful run, GET /runs/:id/detail must include stepInputs
 * with resolved params (key stepId::iteration) for the debugger contract.
 * Also verifies apiKey-shaped param is redacted in persisted snapshot.
 * Usage: node scripts/step-inputs-detail-test.js
 * Requires API + infra (same as success-basic-test).
 */

import "./load-root-env.js";
import axios from "axios";

const API_URL = process.env.API_URL || "http://localhost:4000";

async function createWorkflow(body) {
  const res = await axios.post(`${API_URL}/workflows`, body);
  return res.data._id?.toString() || res.data.id;
}

async function triggerWebhook(workflowId, body = {}) {
  const res = await axios.post(`${API_URL}/webhook/${workflowId}`, body);
  return res.data.runId?.toString() || res.data.runId;
}

async function getRunDetail(runId) {
  const res = await axios.get(`${API_URL}/runs/${runId}/detail`);
  return res.data;
}

async function pollUntilFinished(runId, maxWaitMs = 60000, intervalMs = 400) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await axios.get(`${API_URL}/runs/${runId}`);
    const run = res.data;
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Run ${runId} did not finish within ${maxWaitMs}ms`);
}

async function run() {
  console.log("\n[TEST] step-inputs-detail-test");

  const workflowId = await createWorkflow({
    name: "Test stepInputs snapshot",
    trigger: { type: "trigger.webhook" },
    steps: [
      {
        id: "log_var",
        type: "log",
        params: {
          message: "Hello {{ trigger.body.name }}",
          apiKey: "should-not-appear-in-clear-text",
        },
        dependsOn: [],
      },
    ],
    maxParallel: 5,
  });

  const runId = await triggerWebhook(workflowId, { name: "Tester" });
  const finished = await pollUntilFinished(runId);
  if (finished.status !== "completed") {
    console.error("[FAIL] Expected completed, got", finished.status);
    process.exit(1);
  }

  const detail = await getRunDetail(runId);
  const key = "log_var::0";
  const entry = detail.stepInputs?.[key];
  if (!entry || typeof entry.params !== "object") {
    console.error("[FAIL] Missing stepInputs[", key, "]", JSON.stringify(detail.stepInputs ?? null).slice(0, 300));
    process.exit(1);
  }

  if (entry.params.message !== "Hello Tester") {
    console.error("[FAIL] Resolved message mismatch:", entry.params.message);
    process.exit(1);
  }

  if (entry.params.apiKey !== "[REDACTED]") {
    console.error("[FAIL] apiKey should be redacted in stepInputs, got:", entry.params.apiKey);
    process.exit(1);
  }

  if (!entry.executionId || typeof entry.executionId !== "string") {
    console.error("[FAIL] executionId missing on stepInputs entry");
    process.exit(1);
  }

  if (detail.lastError != null && detail.lastError !== undefined && Object.keys(detail.lastError || {}).length) {
    console.warn("[WARN] Expected no lastError on success, got:", detail.lastError);
  }

  console.log("[OK] stepInputs.detail shape + resolution + redaction");
}

run().catch((err) => {
  console.error("[FAIL]", err.response?.data || err.message);
  process.exit(1);
});

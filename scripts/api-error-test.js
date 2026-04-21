/**
 * api-error-test.js
 * Simulate OpenAI API failure (invalid API key or invalid model).
 * Expect: Step fails, error message logged, workflow fails.
 * Usage: node scripts/api-error-test.js [WORKFLOW_ID]
 */

import "./load-root-env.js";
import axios from "axios";

const API_URL = process.env.API_URL || "http://localhost:4000";
const WORKFLOW_ID = process.argv[2] || process.env.WORKFLOW_ID;

async function createWorkflow(body) {
  const res = await axios.post(`${API_URL}/workflows`, body);
  return res.data._id?.toString() || res.data.id;
}

async function startRun(workflowId) {
  const res = await axios.post(`${API_URL}/workflows/${workflowId}/run`, {});
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
  console.log("\n[TEST] api-error-test");
  const startAll = Date.now();

  let workflowId = WORKFLOW_ID;
  if (!workflowId) {
    console.log("[TEST] Creating openai workflow with invalid apiKey...");
    workflowId = await createWorkflow({
      name: "Test API Error",
      trigger: { type: "manual" },
      steps: [
        {
          id: "step_0",
          type: "openai",
          params: {
            prompt: "Say hello",
            apiKey: "invalid-key-xyz-12345",
            model: "gpt-4o-mini",
            maxTokens: 10,
          },
          dependsOn: [],
        },
      ],
      maxParallel: 5,
    });
    console.log(`[TEST] Created workflow: ${workflowId}`);
  }

  const runId = await startRun(workflowId);
  console.log(`[TEST] Run started: ${runId}`);

  const run = await pollUntilFinished(runId);
  const totalMs = Date.now() - startAll;

  if (run.status !== "failed") {
    console.error(`[FAIL] Expected failed, got ${run.status}`);
    process.exit(1);
  }

  const failedStep = (run.stepStates || []).find((s) => s.status === "failed");
  if (!failedStep) {
    console.error(`[FAIL] No failed step found`);
    process.exit(1);
  }

  const errorLog = (run.logs || []).find((l) => l.level === "error" || (l.message && (l.message.includes("API") || l.message.includes("401") || l.message.includes("Invalid"))));
  if (errorLog) {
    console.log(`[OK] Error logged: ${(errorLog.message || errorLog.error || "").slice(0, 80)}...`);
  }

  console.log(`[OK] Run failed as expected, step ${failedStep.stepId} failed, total ${totalMs}ms`);
}

run().catch((err) => {
  console.error("[FAIL]", err.response?.data || err.message);
  process.exit(1);
});

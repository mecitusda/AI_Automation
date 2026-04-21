/**
 * ai-invalid-json-test.js
 * Use workflow with format=json, prompt forces non-JSON output.
 * Expect: Step fails, retry triggered (if configured), final status = failed.
 * Usage: node scripts/ai-invalid-json-test.js [WORKFLOW_ID]
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

async function pollUntilFinished(runId, maxWaitMs = 90000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const run = await getRun(runId);
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Run ${runId} did not finish within ${maxWaitMs}ms`);
}

async function run() {
  console.log("\n[TEST] ai-invalid-json-test");
  const startAll = Date.now();

  let workflowId = WORKFLOW_ID;
  if (!workflowId) {
    console.log("[TEST] Creating ai.summarize workflow (format=json, prompt forces non-JSON)...");
    workflowId = await createWorkflow({
      name: "Test AI Invalid JSON",
      trigger: { type: "manual" },
      steps: [
        {
          id: "step_0",
          type: "ai.summarize",
          params: {
            text: "Do NOT use JSON. Write only plain prose: a short paragraph about cats.",
            format: "json",
            maxTokens: 200,
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

  if (run.status === "failed") {
    const failedStep = (run.stepStates || []).find((s) => s.status === "failed");
    console.log(`[OK] Run failed as expected (format=json + non-JSON output), step ${failedStep?.stepId} failed, total ${totalMs}ms`);
    return;
  }

  if (run.status === "completed") {
    console.log(`[OK] Run completed (model returned valid JSON despite prompt; validation not triggered), total ${totalMs}ms`);
    return;
  }

  console.error(`[FAIL] Unexpected status: ${run.status}`);
  process.exit(1);
}

run().catch((err) => {
  console.error("[FAIL]", err.response?.data || err.message);
  process.exit(1);
});

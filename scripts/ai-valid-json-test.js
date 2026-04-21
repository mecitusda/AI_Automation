/**
 * ai-valid-json-test.js
 * Prompt returns correct JSON. Expect: Step success, output parsed correctly.
 * Usage: node scripts/ai-valid-json-test.js [WORKFLOW_ID]
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
  console.log("\n[TEST] ai-valid-json-test");
  const startAll = Date.now();

  let workflowId = WORKFLOW_ID;
  if (!workflowId) {
    console.log("[TEST] Creating ai.summarize workflow (format=json, prompt returns JSON)...");
    workflowId = await createWorkflow({
      name: "Test AI Valid JSON",
      trigger: { type: "manual" },
      steps: [
        {
          id: "step_0",
          type: "ai.summarize",
          params: {
            text: "Return only this exact JSON with no other text: {\"summary\":\"ok\"}",
            format: "json",
            maxTokens: 100,
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

  if (run.status !== "completed") {
    console.error(`[FAIL] Expected completed, got ${run.status}`);
    process.exit(1);
  }

  const step = (run.stepStates || []).find((s) => s.stepId === "step_0");
  if (!step || step.status !== "completed") {
    console.error(`[FAIL] step_0 should be completed`);
    process.exit(1);
  }

  let output = run.outputs?.step_0 ?? run.outputs?.["step_0"];
  if (output && typeof output === "object" && "0" in output) output = output["0"];
  if (run.outputs instanceof Map) {
    output = run.outputs.get("step_0");
    if (output && typeof output === "object" && "0" in output) output = output["0"];
  }

  const parsed = output && (typeof output === "object" ? output : JSON.parse(String(output)));
  if (!parsed || typeof parsed !== "object") {
    console.error(`[FAIL] Output should be parsed object, got`, output);
    process.exit(1);
  }

  console.log(`[OK] Run completed, output parsed:`, JSON.stringify(parsed).slice(0, 80) + "...");
  console.log(`[OK] Total ${totalMs}ms`);
}

run().catch((err) => {
  console.error("[FAIL]", err.response?.data || err.message);
  process.exit(1);
});

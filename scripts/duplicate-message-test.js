import "./load-root-env.js";
import axios from "axios";
import amqp from "amqplib";
import mongoose from "mongoose";

const API_URL = process.env.API_URL || "http://localhost:4000";
const MONGO_URL = process.env.MONGO_URL;
const RABBIT_URL = process.env.RABBIT_URL;
if (!MONGO_URL || !RABBIT_URL) {
  console.error("MONGO_URL and RABBIT_URL are required for duplicate-message-test");
  process.exit(1);
}

const runSchema = new mongoose.Schema({}, { strict: false, collection: "runs" });
const Run = mongoose.model("RunDupTest", runSchema);

async function waitFor(cond, timeoutMs = 20000, intervalMs = 300) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const out = await cond();
    if (out) return out;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

async function createWorkflow() {
  const res = await axios.post(`${API_URL}/workflows`, {
    name: "Duplicate Message Guard Test",
    trigger: { type: "trigger.webhook" },
    steps: [
      { id: "delay_1", type: "delay", params: { ms: 1500 }, dependsOn: [] },
      { id: "log_1", type: "log", params: { message: "done" }, dependsOn: ["delay_1"] }
    ],
    maxParallel: 1
  });
  return res.data._id || res.data.id;
}

async function trigger(workflowId) {
  const res = await axios.post(`${API_URL}/webhook/${workflowId}`, {});
  return res.data.runId;
}

async function run() {
  console.log("[TEST] duplicate-message-test");
  await mongoose.connect(MONGO_URL);
  const connection = await amqp.connect(RABBIT_URL);
  const ch = await connection.createChannel();
  const workflowId = await createWorkflow();
  const runId = await trigger(workflowId);

  const runningState = await waitFor(async () => {
    const runDoc = await Run.findById(runId).lean();
    const st = (runDoc?.stepStates || []).find((s) => s.stepId === "delay_1" && s.status === "running");
    if (!st?.executionId) return null;
    return { runDoc, st };
  });

  if (!runningState) throw new Error("No running step found for duplicate injection");

  const payload = {
    executionId: runningState.st.executionId,
    runId,
    stepIndex: 0,
    iteration: 0,
    attempt: 0,
    step: { id: "delay_1", type: "delay", params: { ms: 1500 } },
    previousOutput: null,
    globalToken: "dup-test-token",
    loopStepId: null
  };

  await ch.publish("automation.direct", "step.execute", Buffer.from(JSON.stringify(payload)));
  await ch.publish("automation.direct", "step.execute", Buffer.from(JSON.stringify(payload)));

  const done = await waitFor(async () => {
    const runDoc = await Run.findById(runId).lean();
    if (!runDoc) return null;
    if (!["completed", "failed", "cancelled"].includes(runDoc.status)) return null;
    return runDoc;
  }, 30000, 500);

  if (!done) throw new Error("Run did not finish in time");

  const stepSuccessLogs = (done.logs || []).filter(
    (l) => l.stepId === "delay_1" && String(l.message || "").includes("[STEP COMPLETE]")
  );
  if (stepSuccessLogs.length > 1) {
    throw new Error(`Duplicate execution detected, success log count=${stepSuccessLogs.length}`);
  }

  console.log("[OK] Duplicate message guard prevented double execution");
  await ch.close();
  await connection.close();
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("[FAIL]", err?.message || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});

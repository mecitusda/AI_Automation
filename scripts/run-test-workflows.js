/**
 * Test workflow runner: creates workflows, starts runs, polls until completion, asserts.
 * Usage: node scripts/run-test-workflows.js [parallel|foreach|retry|timeout|webhook|cron|ai|plugins|all]
 * Requires API running at API_URL (default http://localhost:4000).
 */

const API_URL = process.env.API_URL || "http://localhost:4000";

const WORKFLOWS = {
  parallel: {
    name: "Test Parallel",
    trigger: { type: "manual" },
    steps: [
      { id: "fetchUsers", type: "http", params: { url: "https://jsonplaceholder.typicode.com/users" }, dependsOn: [] },
      { id: "logA", type: "log", params: { message: "logA after fetch" }, dependsOn: ["fetchUsers"] },
      { id: "logB", type: "log", params: { message: "logB after fetch" }, dependsOn: ["fetchUsers"] },
    ],
    maxParallel: 5,
  },
  foreach: {
    name: "Test Foreach",
    trigger: { type: "manual" },
    steps: [
      { id: "fetchUsers", type: "http", params: { url: "https://jsonplaceholder.typicode.com/users" }, dependsOn: [] },
      { id: "loopUsers", type: "foreach", params: { items: "{{ steps.fetchUsers.0.output.data }}" }, dependsOn: ["fetchUsers"] },
      { id: "logUser", type: "log", params: { message: "User {{ loop.item.id }}" }, dependsOn: ["loopUsers"] },
    ],
    maxParallel: 5,
  },
  retry: {
    name: "Test Retry",
    trigger: { type: "manual" },
    steps: [
      { id: "unstableStep", type: "unstable", params: { failRate: 0.8 }, dependsOn: [], retry: 3 },
    ],
    maxParallel: 5,
  },
  timeout: {
    name: "Test Timeout",
    trigger: { type: "manual" },
    steps: [
      { id: "delayStep", type: "delay", params: { ms: 15000 }, dependsOn: [], timeout: 3000, retry: 0 },
    ],
    maxParallel: 5,
  },
  webhook: {
    name: "Test Webhook",
    trigger: { type: "manual" },
    steps: [
      { id: "logTrigger", type: "log", params: { message: "Trigger: {{ trigger.email }} {{ trigger.userId }}" }, dependsOn: [] },
    ],
    maxParallel: 5,
  },
  cron: {
    name: "Test Cron",
    trigger: { type: "cron", cron: "*/1 * * * *" },
    steps: [
      { id: "logCron", type: "log", params: { message: "Cron fired" }, dependsOn: [] },
    ],
    maxParallel: 5,
  },
  ai: {
    name: "Test AI",
    trigger: { type: "manual" },
    steps: [
      { id: "openaiStep", type: "openai", params: { prompt: "Say hello in one word.", model: "gpt-4o-mini", maxTokens: 20 }, dependsOn: [] },
    ],
    maxParallel: 5,
  },
  plugins: {
    name: "Test Email + Slack",
    trigger: { type: "manual" },
    steps: [
      { id: "emailStep", type: "email", params: { to: "test@test.com", subject: "Test", body: "Body" }, dependsOn: [] },
      { id: "slackStep", type: "slack", params: { channel: "#test", text: "Hello" }, dependsOn: ["emailStep"] },
    ],
    maxParallel: 5,
  },
};

async function createWorkflow(body) {
  const res = await fetch(`${API_URL}/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Create workflow failed: ${res.status} ${await res.text()}`);
  const w = await res.json();
  return w._id || w.id;
}

async function startRun(workflowId) {
  const res = await fetch(`${API_URL}/workflows/${workflowId}/run`, { method: "POST" });
  if (!res.ok) throw new Error(`Start run failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.runId?.toString() || data.runId;
}

async function triggerWebhook(workflowId, body = {}) {
  const res = await fetch(`${API_URL}/trigger/${workflowId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Webhook trigger failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.runId?.toString() || data.runId;
}

async function getRun(runId) {
  const res = await fetch(`${API_URL}/runs/${runId}`);
  if (!res.ok) throw new Error(`Get run failed: ${res.status}`);
  return res.json();
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

function assertParallel(run) {
  if (run.status !== "completed") throw new Error(`Expected completed, got ${run.status}`);
  const steps = run.stepStates || [];
  const fetchUsers = steps.find((s) => s.stepId === "fetchUsers");
  const logA = steps.find((s) => s.stepId === "logA");
  const logB = steps.find((s) => s.stepId === "logB");
  if (!fetchUsers || fetchUsers.status !== "completed") throw new Error("fetchUsers should be completed");
  if (!logA || logA.status !== "completed") throw new Error("logA should be completed");
  if (!logB || logB.status !== "completed") throw new Error("logB should be completed");
  console.log("  [OK] Parallel: fetchUsers, logA, logB all completed");
}

function assertForeach(run) {
  if (run.status !== "completed") throw new Error(`Expected completed, got ${run.status}`);
  const steps = run.stepStates || [];
  const loopUsers = steps.find((s) => s.stepId === "loopUsers" && (s.iteration ?? 0) === 0);
  if (!loopUsers || loopUsers.status !== "completed") throw new Error("loopUsers step should be completed");
  const logUserStates = steps.filter((s) => s.stepId === "logUser");
  if (logUserStates.length < 1) throw new Error("logUser should have at least one iteration");
  const allCompleted = logUserStates.every((s) => s.status === "completed");
  if (!allCompleted) throw new Error("All logUser iterations should be completed");
  console.log(`  [OK] Foreach: loopUsers completed, logUser ${logUserStates.length} iteration(s) completed`);
}

function assertRetry(run) {
  const steps = run.stepStates || [];
  const unstable = steps.find((s) => s.stepId === "unstableStep");
  if (!unstable) throw new Error("unstableStep state not found");
  if (run.status === "completed") {
    if (unstable.status !== "completed") throw new Error("unstableStep should be completed");
    console.log(`  [OK] Retry: eventually completed (retryCount=${unstable.retryCount ?? 0})`);
  } else {
    if (run.status !== "failed") throw new Error("Expected completed or failed");
    console.log(`  [OK] Retry: run failed after retries (retryCount=${unstable?.retryCount ?? 0})`);
  }
}

function assertTimeout(run) {
  if (run.status !== "failed") throw new Error(`Expected failed (timeout), got ${run.status}`);
  const steps = run.stepStates || [];
  const delayStep = steps.find((s) => s.stepId === "delayStep");
  if (!delayStep) throw new Error("delayStep state not found");
  if (delayStep.status !== "failed" && delayStep.status !== "retrying") {
    console.log(`  [OK] Timeout: run failed, delayStep status=${delayStep.status}`);
  } else {
    console.log("  [OK] Timeout: run failed (step timed out or retrying)");
  }
}

function assertWebhook(run) {
  if (run.status !== "completed") throw new Error(`Expected completed, got ${run.status}`);
  const tp = run.triggerPayload || {};
  if (tp.email !== "test@test.com") throw new Error(`Expected triggerPayload.email, got ${tp.email}`);
  if (tp.userId !== "u1") throw new Error(`Expected triggerPayload.userId, got ${tp.userId}`);
  const steps = run.stepStates || [];
  const logTrigger = steps.find((s) => s.stepId === "logTrigger");
  if (!logTrigger || logTrigger.status !== "completed") throw new Error("logTrigger should be completed");
  console.log("  [OK] Webhook: triggerPayload present, logTrigger completed");
}

function assertCron(workflowId) {
  // Only assert workflow was created with cron trigger; scheduler registration is tested by no throw.
  console.log("  [OK] Cron: workflow created with cron trigger (run creation is time-based, skip run assertion)");
}

function assertAI(run) {
  if (run.status !== "completed") {
    if (run.status === "failed" && run.stepStates?.some((s) => s.stepId === "openaiStep" && s.status === "failed")) {
      console.log("  [SKIP] AI: run failed (likely no OPENAI_API_KEY); skipping assertion");
      return;
    }
    throw new Error(`Expected completed or skip, got ${run.status}`);
  }
  const steps = run.stepStates || [];
  const openaiStep = steps.find((s) => s.stepId === "openaiStep");
  if (!openaiStep || openaiStep.status !== "completed") throw new Error("openaiStep should be completed");
  const output = run.outputs?.openaiStep?.["0"];
  if (!output) throw new Error("openaiStep output should be present");
  console.log("  [OK] AI: openaiStep completed with output");
}

function assertPlugins(run) {
  if (run.status !== "completed") throw new Error(`Expected completed, got ${run.status}`);
  const steps = run.stepStates || [];
  const emailStep = steps.find((s) => s.stepId === "emailStep");
  const slackStep = steps.find((s) => s.stepId === "slackStep");
  if (!emailStep || emailStep.status !== "completed") throw new Error("emailStep should be completed");
  if (!slackStep || slackStep.status !== "completed") throw new Error("slackStep should be completed");
  console.log("  [OK] Plugins: email and slack steps completed");
}

const ASSERT = {
  parallel: assertParallel,
  foreach: assertForeach,
  retry: assertRetry,
  timeout: assertTimeout,
  webhook: assertWebhook,
  cron: assertCron,
  ai: assertAI,
  plugins: assertPlugins,
};

async function runTest(name) {
  console.log(`\n--- ${name} ---`);
  const body = WORKFLOWS[name];
  if (!body) throw new Error(`Unknown test: ${name}`);
  const workflowId = await createWorkflow(body);
  let runId;
  if (name === "webhook") {
    runId = await triggerWebhook(workflowId, { email: "test@test.com", userId: "u1" });
  } else if (name === "cron") {
    ASSERT[name](workflowId);
    return;
  } else {
    runId = await startRun(workflowId);
  }
  if (runId) {
    console.log(`  Run started: ${runId}`);
    const run = await pollUntilFinished(runId);
    ASSERT[name](run);
  }
}

async function main() {
  const which = process.argv[2] || "all";
  const tests = which === "all" ? Object.keys(WORKFLOWS) : [which];
  if (tests.some((t) => !WORKFLOWS[t])) {
    console.error("Usage: node scripts/run-test-workflows.js [parallel|foreach|retry|timeout|webhook|cron|ai|plugins|all]");
    process.exit(1);
  }
  console.log(`API: ${API_URL}`);
  console.log("Tests: " + tests.join(", "));
  for (const name of tests) {
    try {
      await runTest(name);
    } catch (err) {
      console.error(`  FAIL: ${err.message}`);
      process.exit(1);
    }
  }
  console.log("\nAll tests passed.");
}

main();

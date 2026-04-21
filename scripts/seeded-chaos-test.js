import "./load-root-env.js";
import axios from "axios";

const API_URL = process.env.API_URL || "http://localhost:4000";

async function run() {
  console.log("[TEST] seeded-chaos-test");
  if (process.env.CHAOS_MODE !== "true") {
    console.log("[INFO] CHAOS_MODE is not true. Set CHAOS_MODE=true and CHAOS_SEED=42 for deterministic run.");
    process.exit(0);
  }

  const wf = await axios.post(`${API_URL}/workflows`, {
    name: "Seeded Chaos Test",
    trigger: { type: "trigger.webhook" },
    steps: [
      { id: "delay_1", type: "delay", params: { ms: 100 }, retry: 1, dependsOn: [] },
      { id: "log_1", type: "log", params: { message: "chaos" }, dependsOn: ["delay_1"] }
    ],
    maxParallel: 1
  });
  const workflowId = wf.data._id || wf.data.id;
  const tr = await axios.post(`${API_URL}/webhook/${workflowId}`, {});
  const runId = tr.data.runId;
  console.log(`[OK] Seeded chaos run queued: ${runId}`);
}

run().catch((err) => {
  console.error("[FAIL]", err.response?.data || err.message);
  process.exit(1);
});

import "./load-root-env.js";
import axios from "axios";

const API_URL = process.env.API_URL || "http://localhost:4000";
const WORKFLOW_ID = process.env.WORKFLOW_ID;
const DURATION_SEC = Number(process.env.SOAK_DURATION_SEC || 3600);
const RPS = Number(process.env.SOAK_RPS || 2);

if (!WORKFLOW_ID) {
  console.error("WORKFLOW_ID is required");
  process.exit(1);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log(`[SOAK] Starting soak test for ${DURATION_SEC}s at ~${RPS} rps`);
  const endAt = Date.now() + DURATION_SEC * 1000;
  let ok = 0;
  let fail = 0;
  while (Date.now() < endAt) {
    const batch = [];
    for (let i = 0; i < RPS; i++) {
      batch.push(
        axios.post(`${API_URL}/webhook/${WORKFLOW_ID}`, { t: Date.now() })
          .then(() => { ok += 1; })
          .catch(() => { fail += 1; })
      );
    }
    await Promise.all(batch);
    await sleep(1000);
  }
  console.log(JSON.stringify({
    level: "info",
    event: "soak.completed",
    timestamp: new Date().toISOString(),
    ok,
    fail,
    durationSec: DURATION_SEC,
    rps: RPS
  }));
}

run().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});

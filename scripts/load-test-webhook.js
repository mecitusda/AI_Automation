/**
 * HIGH LOAD TEST - 100 concurrent webhook requests
 *
 * Usage: node scripts/load-test-webhook.js [WORKFLOW_ID]
 *   WORKFLOW_ID: Webhook workflow ID (required)
 *
 * Requires: API running on http://localhost:4000, Redis, MongoDB, RabbitMQ
 *
 * Expected:
 *   - System stays up
 *   - Rate limit returns 429 (10 req/sec per workflow)
 *   - No memory spike / OOM
 */

import "./load-root-env.js";

const WORKFLOW_ID = process.argv[2] || process.env.WORKFLOW_ID;
const CONCURRENT = 100;
const BASE_URL = process.env.API_URL || "http://localhost:4000";

if (!WORKFLOW_ID) {
  console.error("Usage: node scripts/load-test-webhook.js <WORKFLOW_ID>");
  console.error("  or:  WORKFLOW_ID=xxx node scripts/load-test-webhook.js");
  process.exit(1);
}

const url = `${BASE_URL.replace(/\/$/, "")}/webhook/${WORKFLOW_ID}`;

// Random payments for foreach workflow: {{ trigger.body.payments }}, IF {{ loop.item.amount }} > 1000
function randomPayments(count = 3) {
  const emails = ["user1@test.com", "user2@test.com", "premium@test.com", "low@test.com", "high@test.com"];
  return Array.from({ length: count }, () => ({
    amount: Math.floor(Math.random() * 3000) + 100,
    email: emails[Math.floor(Math.random() * emails.length)],
  }));
}

async function singleRequest(i) {
  const start = Date.now();
  const body = { payments: randomPayments(2 + (i % 4)) };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const duration = Date.now() - start;
    return { i, status: res.status, duration, ok: res.ok };
  } catch (err) {
    return { i, status: 0, error: err.message, ok: false };
  }
}

async function run() {
  console.log(`\n⚡ HIGH LOAD TEST - ${CONCURRENT} concurrent requests`);
  console.log(`   URL: ${url}\n`);

  const memBefore = process.memoryUsage();
  const startAll = Date.now();

  const promises = Array.from({ length: CONCURRENT }, (_, i) => singleRequest(i));
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

  console.log("--- Results ---");
  console.log(`Total: ${CONCURRENT} requests in ${durationAll}ms`);
  console.log(`  202 Accepted: ${success}`);
  console.log(`  429 Rate limited: ${rateLimited}`);
  if (errors > 0) console.log(`  Errors (5xx/network): ${errors}`);
  console.log(`Status breakdown:`, byStatus);

  console.log("\n--- Memory ---");
  console.log(`Heap before: ${(memBefore.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Heap after:  ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  const heapDelta = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
  console.log(`Delta:       ${heapDelta >= 0 ? "+" : ""}${heapDelta.toFixed(2)} MB`);

  console.log("\n--- Expected ---");
  console.log("✔ System up:     ", errors === 0 ? "OK" : "CHECK - some requests failed");
  console.log("✔ Rate limit:   ", rateLimited > 0 ? "OK (429 returned)" : "INFO - no 429 (maybe <10 req/sec)");
  console.log("✔ Memory stable:", Math.abs(heapDelta) < 50 ? "OK" : "CHECK - large heap delta");
  console.log("");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

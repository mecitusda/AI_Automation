/**
 * Unit test for redactExecutionParams (no API / DB).
 * Run: npm run test:redact
 */

import { redactExecutionParams } from "../apps/api/src/utils/redactExecutionParams.js";

function assert(cond, msg) {
  if (!cond) {
    console.error("[FAIL]", msg);
    process.exit(1);
  }
}

function run() {
  console.log("\n[TEST] redact-execution-params-test");

  const a = redactExecutionParams({
    url: "https://example.com",
    apiKey: "sk-secret",
    nested: { password: "x", safe: 1 },
  });
  assert(a.apiKey === "[REDACTED]", "apiKey should be redacted");
  assert(a.nested.password === "[REDACTED]", "nested password redacted");
  assert(a.nested.safe === 1, "safe field preserved");
  assert(a.url === "https://example.com", "url preserved");

  const b = redactExecutionParams({ prompt: "hello" });
  assert(b.prompt === "hello", "prompt preserved");

  console.log("[OK] redactExecutionParams");
}

run();

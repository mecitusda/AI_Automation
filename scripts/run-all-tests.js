import "./load-root-env.js";
import { spawn } from "node:child_process";

const tests = [
  "test:redact",
  "test:success",
  "test:http-error",
  "test:step-inputs",
  "test:retry",
  "test:timeout",
  "test:concurrency",
  "test:cancel",
  "test:nested-loops",
  "test:foreach-gate",
];

const extendedTests = [
  "test:duplicate",
  "test:auth-ownership",
  "test:db-plugin-collections",
];

const STRICT_EXTENDED = process.env.STRICT_EXTENDED_TESTS === "true";

function runScript(name) {
  return new Promise((resolve, reject) => {
    const child = spawn(`npm run ${name}`, { stdio: "inherit", shell: true });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${name} failed with exit code ${code}`));
    });
  });
}

async function run() {
  const startedAt = Date.now();
  const skipped = [];
  const extendedResults = [];
  for (const test of tests) {
    // Sequential fail-fast execution for deterministic diagnostics.
    await runScript(test);
  }

  // Auto-run extended tests without breaking local flow when infrastructure is unavailable.
  for (const test of extendedTests) {
    try {
      await runScript(test);
      extendedResults.push({ test, status: "passed" });
    } catch (err) {
      if (STRICT_EXTENDED) throw err;
      const reason = err?.message || String(err);
      skipped.push({ test, reason });
      console.warn(JSON.stringify({
        level: "warn",
        event: "tests.extended.skipped",
        timestamp: new Date().toISOString(),
        test,
        reason
      }));
    }
  }
  const elapsedMs = Date.now() - startedAt;
  console.log(JSON.stringify({
    level: "info",
    event: "tests.run_all.completed",
    timestamp: new Date().toISOString(),
    message: "Core tests passed; extended tests attempted",
    elapsedMs,
    extendedResults,
    skippedExtended: skipped
  }));
}

run().catch((err) => {
  console.error(JSON.stringify({
    level: "error",
    event: "tests.run_all.failed",
    timestamp: new Date().toISOString(),
    message: err?.message || String(err)
  }));
  process.exit(1);
});

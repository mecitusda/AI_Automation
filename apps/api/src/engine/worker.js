import { channel } from "../config/rabbit.js";
import { getPlugin } from "../plugins/registry.js";
import { Credential } from "../models/credential.model.js";
import { Run } from "../models/run.model.js";
import { redis } from "../config/redis.js";
import { decrypt } from "../utils/credentialCrypto.js";
import * as rateLimiter from "../utils/rateLimiter.js";
import { normalizePluginResult } from "../utils/pluginResult.js";
import { logInfo, logWarn, logError } from "../utils/logger.js";

const controllers = new Map(); // executionId -> AbortController
const DEBUG_RUN = process.env.DEBUG_RUN === "true";
const CHAOS_MODE = process.env.CHAOS_MODE === "true";
const WORKER_PLUGIN_TIMEOUT_MS = Number(process.env.WORKER_PLUGIN_TIMEOUT_MS || 0);
const STEP_LOCK_TTL_MS = Number(process.env.STEP_LOCK_TTL_MS || 60_000);
const CREDENTIAL_CACHE_TTL_MS = Number(process.env.CREDENTIAL_CACHE_TTL_MS || 5 * 60_000);
const CHAOS_SEED = Number(process.env.CHAOS_SEED || 0);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** When plugin omits meta.errorMessage but returns HTTP-shaped output. */
function deriveErrorMessageFromHttpLikeOutput(output) {
  if (!output || typeof output !== "object") return undefined;
  const status = output.status;
  if (typeof status !== "number" || status < 400) return undefined;
  const data = output.data;
  let snippet = "";
  try {
    const s = typeof data === "string" ? data : JSON.stringify(data);
    snippet = s && s.length > 800 ? `${s.slice(0, 800)}…` : s || "";
  } catch {
    snippet = String(data).slice(0, 800);
  }
  return `HTTP ${status}` + (snippet ? ` — ${snippet}` : "");
}
const CREDENTIAL_CACHE_MAX = 100;
const credentialCache = new Map(); // credentialId -> { value, expiresAt }
let chaosState = CHAOS_SEED || Date.now();

function nextChaosRandom() {
  chaosState = (chaosState * 1664525 + 1013904223) % 4294967296;
  return chaosState / 4294967296;
}

function getCachedCredential(credentialId) {
  const entry = credentialCache.get(credentialId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    credentialCache.delete(credentialId);
    return undefined;
  }
  return entry.value;
}

function setCachedCredential(credentialId, data) {
  if (credentialCache.size >= CREDENTIAL_CACHE_MAX) {
    const firstKey = credentialCache.keys().next().value;
    if (firstKey !== undefined) credentialCache.delete(firstKey);
  }
  credentialCache.set(credentialId, {
    value: data,
    expiresAt: Date.now() + CREDENTIAL_CACHE_TTL_MS,
  });
}

function invalidateCredentialCache(credentialId) {
  credentialCache.delete(credentialId);
}

async function resolveCredential(credentialId, { userId, runId, workflowId } = {}) {
  const cached = getCachedCredential(credentialId);
  if (cached !== undefined) {
    await Credential.updateOne(
      { _id: credentialId, ...(userId ? { userId } : {}) },
      {
        $set: { lastAccessAt: new Date(), ...(runId ? { lastUsedByRunId: runId } : {}), ...(workflowId ? { lastUsedInWorkflowId: workflowId } : {}) },
        $inc: { accessCount: 1 }
      }
    );
    return cached;
  }
  const doc = await Credential.findOne({ _id: credentialId, ...(userId ? { userId } : {}) }).lean();
  if (!doc || !doc.data) return null;
  try {
    const data = decrypt(doc.data);
    setCachedCredential(credentialId, data);
    await Credential.updateOne(
      { _id: credentialId, ...(userId ? { userId } : {}) },
      {
        $set: { lastAccessAt: new Date(), ...(runId ? { lastUsedByRunId: runId } : {}), ...(workflowId ? { lastUsedInWorkflowId: workflowId } : {}) },
        $inc: { accessCount: 1 }
      }
    );
    return data;
  } catch (err) {
    invalidateCredentialCache(credentialId);
    throw err;
  }
}

async function isExecutionValidForRun({ runId, stepId, iteration = 0, executionId }) {
  const run = await Run.findById(runId)
    .select({ status: 1, processedMessages: 1, stepStates: 1, userId: 1, workflowId: 1 })
    .lean();
  if (!run) return { ok: false, reason: "run_not_found", run: null };
  if (["completed", "failed", "cancelled"].includes(run.status)) {
    return { ok: false, reason: "run_terminal", run };
  }
  if (Array.isArray(run.processedMessages) && run.processedMessages.includes(executionId)) {
    return { ok: false, reason: "already_processed", run };
  }

  const st = (run.stepStates || []).find(
    (s) => s.stepId === stepId && (s.iteration ?? 0) === (iteration ?? 0)
  );
  if (!st) return { ok: false, reason: "step_state_missing", run };
  if (!["running", "retrying"].includes(st.status)) return { ok: false, reason: `invalid_state_${st.status}`, run };
  if (st.executionId !== executionId) return { ok: false, reason: "execution_id_mismatch", run };
  return { ok: true, run };
}

async function withPluginGuard(executor, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return executor();
  return Promise.race([
    executor(),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Worker plugin timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

async function maybeChaos() {
  if (!CHAOS_MODE) return;
  const roll = nextChaosRandom();
  if (roll < 0.15) {
    await sleep(100 + Math.floor(nextChaosRandom() * 400));
  }
  if (roll >= 0.15 && roll < 0.2) {
    throw new Error("CHAOS_MODE injected worker failure");
  }
}

async function acquireStepLock(executionId) {
  const key = `step:lock:${executionId}`;
  const ok = await redis.set(key, executionId, "PX", STEP_LOCK_TTL_MS, "NX");
  return ok === "OK" ? key : null;
}

const RELEASE_STEP_LOCK_LUA = `
  local cur = redis.call("GET", KEYS[1])
  if cur == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

async function releaseStepLock(lockKey, executionId) {
  if (!lockKey) return;
  try {
    await redis.eval(RELEASE_STEP_LOCK_LUA, 1, lockKey, executionId);
  } catch {
    // best-effort unlock
  }
}

export async function startWorker() {

  // ✅ Cancel consumer
  await channel.consume("step.cancel.q", async (msg) => {
    if (!msg) return;

    try {
      const { executionId, reason } = JSON.parse(msg.content.toString());
      const ctrl = controllers.get(executionId);

      if (ctrl) {
        ctrl.abort(new Error(reason || "Cancelled"));
        controllers.delete(executionId);
      }
    } finally {
      channel.ack(msg);
    }
  });

  // ✅ Execute consumer
  await channel.consume("step.execute.q", async (msg) => {
    if (!msg) return;

    try {
      const { executionId, runId, stepIndex, iteration, step, previousOutput, globalToken, loopStepId, attempt } =
        JSON.parse(msg.content.toString());
      const stepId = step?.id;

      if (!stepId) {
        await channel.publish(
          "automation.direct",
          "step.result",
          Buffer.from(JSON.stringify({
            executionId,
            runId,
            stepIndex,
            iteration,
            success: false,
            error: "Step id is missing in execution payload",
            previousOutput,
            globalToken,
            loopStepId
          }))
        );
        return channel.ack(msg);
      }

      const validity = await isExecutionValidForRun({
        runId,
        stepId,
        iteration,
        executionId
      });
      if (!validity.ok) {
        if (DEBUG_RUN) {
          logWarn("worker.execution.skip", {
            runId,
            stepId,
            executionId,
            iteration: iteration ?? 0,
            message: `Skipped stale/duplicate step.execute (${validity.reason})`
          });
        }
        return channel.ack(msg);
      }
      const runContext = validity.run;
      const stepLockKey = await acquireStepLock(executionId);
      if (!stepLockKey) {
        if (DEBUG_RUN) {
          logWarn("worker.execution.locked_skip", {
            runId,
            stepId,
            executionId,
            message: "Skipped duplicate execution due to distributed step lock"
          });
        }
        return channel.ack(msg);
      }

      const plugin = getPlugin(step?.type);
      if (!plugin) {
        await channel.publish(
          "automation.direct",
          "step.result",
          Buffer.from(JSON.stringify({
            executionId,
            runId,
            stepIndex,
            iteration,
            success: false,
            error: `Plugin not found: ${step?.type ?? "unknown"}`,
            previousOutput,
            globalToken
          }))
        );
        return channel.ack(msg);
      }

      const ctrl = new AbortController();
      controllers.set(executionId, ctrl);

      let params = step.params ?? {};
      const credentialId = params.credentialId;
      const credentialRequired = Array.isArray(plugin.credentials) && plugin.credentials.some((c) => c.required);
      if (credentialRequired && !credentialId) {
        await channel.publish(
          "automation.direct",
          "step.result",
          Buffer.from(JSON.stringify({
            executionId,
            runId,
            stepIndex,
            iteration,
            success: false,
            error: "Credential is required for this step",
            previousOutput,
            globalToken,
            loopStepId
          }))
        );
        return channel.ack(msg);
      }

      let credData = null;
      if (credentialId) {
        try {
          credData = await resolveCredential(credentialId, {
            userId: runContext?.userId,
            runId,
            workflowId: runContext?.workflowId
          });
          if (credData == null) {
            await channel.publish(
              "automation.direct",
              "step.result",
              Buffer.from(JSON.stringify({
                executionId,
                runId,
                stepIndex,
                iteration,
                success: false,
                error: "Credential not found",
                previousOutput,
                globalToken,
                loopStepId
              }))
            );
            return channel.ack(msg);
          }
          params = { ...params, ...credData };
          delete params.credentialId;
        } catch (err) {
          await channel.publish(
            "automation.direct",
            "step.result",
            Buffer.from(JSON.stringify({
              executionId,
              runId,
              stepIndex,
              iteration,
              success: false,
              error: err?.message || String(err) || "Credential decryption failed",
              previousOutput,
              globalToken,
              loopStepId
            }))
          );
          return channel.ack(msg);
        }
      }

      const runExecutor = plugin.executor ?? plugin.execute;
      if (typeof plugin.validate === "function") {
        const validationErrors = plugin.validate(params) || {};
        if (validationErrors && typeof validationErrors === "object" && Object.keys(validationErrors).length > 0) {
          await channel.publish(
            "automation.direct",
            "step.result",
            Buffer.from(JSON.stringify({
              executionId,
              runId,
              stepIndex,
              iteration,
              success: false,
              error: Object.values(validationErrors).map((v) => String(v)).join("; "),
              previousOutput,
              globalToken,
              loopStepId
            }))
          );
          return channel.ack(msg);
        }
      }
      const executionAttempt = typeof attempt === "number" ? attempt : 0;

      const publishResult = (result) => {
        const errorMessage =
          !result.success
            ? result.meta?.errorMessage ??
              (typeof result.output === "string" ? result.output : undefined) ??
              deriveErrorMessageFromHttpLikeOutput(result.output) ??
              "Step failed"
            : undefined;

        const payload = {
          executionId,
          runId,
          stepIndex,
          success: result.success,
          output: result,
          previousOutput,
          globalToken,
          iteration,
          loopStepId
        };
        if (errorMessage) payload.error = errorMessage;
        return channel.publish(
          "automation.direct",
          "step.result",
          Buffer.from(JSON.stringify(payload))
        );
      };

      try {
        const startAt = Date.now();
        if (DEBUG_RUN) {
          logInfo("worker.execution.start", {
            runId,
            stepId,
            executionId,
            attempt: executionAttempt,
            message: "Plugin execution started"
          });
        }
        await rateLimiter.check(step.type);
        try {
          await maybeChaos();
          const raw = await withPluginGuard(
            () =>
              runExecutor({
                params,
                credentials: credData ?? null,
                previousOutput,
                signal: ctrl.signal,
                context: {
                  runId,
                  workflowId: runContext?.workflowId,
                  userId: runContext?.userId,
                  stepId,
                  iteration: iteration ?? 0,
                  executionId,
                  attempt: executionAttempt
                }
              }),
            WORKER_PLUGIN_TIMEOUT_MS
          );

          const durationMs = Date.now() - startAt;
          const result = normalizePluginResult(raw);
          if (!result.meta || typeof result.meta !== "object") result.meta = {};

          result.meta.durationMs = result.meta.durationMs ?? durationMs;
          result.meta.attempt = result.meta.attempt ?? executionAttempt;

          await publishResult(result);
          if (DEBUG_RUN) {
            logInfo("worker.execution.success", {
              runId,
              stepId,
              executionId,
              durationMs,
              attempt: executionAttempt,
              message: "Plugin execution completed"
            });
          }
        } catch (err) {
          const durationMs = Date.now() - startAt;
          const errMsg = err?.message || String(err);
          const isTimeout = typeof errMsg === "string" && errMsg.toLowerCase().includes("timeout");

          const resultErr = {
            success: false,
            output: null,
            meta: {
              durationMs,
              status: isTimeout ? "timeout" : "error",
              errorMessage: errMsg
            }
          };
          resultErr.meta.attempt = executionAttempt;

          await publishResult(resultErr);
          logWarn("worker.execution.failed", {
            runId,
            stepId,
            executionId,
            durationMs,
            attempt: executionAttempt,
            message: errMsg
          });
        }
      } catch (err) {
        const errMsg = err?.message || String(err);
        const resultErr = {
          success: false,
          output: null,
          meta: {
            durationMs: null,
            status: "error",
            errorMessage: errMsg
          }
        };
        resultErr.meta.attempt = executionAttempt;
        await publishResult(resultErr);
        logError("worker.execution.error", {
          runId,
          stepId,
          executionId,
          attempt: executionAttempt,
          message: errMsg
        });
      } finally {
        controllers.delete(executionId);
        await releaseStepLock(stepLockKey, executionId);
      }
      channel.ack(msg);
    } catch (err) {
      logError("worker.execution.consumer_error", {
        message: err?.message || String(err)
      });
      channel.nack(msg, false, true);
    }
  });

  logInfo("worker.start", { message: "Worker running..." });
}
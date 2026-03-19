import { channel } from "../config/rabbit.js";
import { getPlugin } from "../plugins/registry.js";
import { Credential } from "../models/credential.model.js";
import { decrypt } from "../utils/credentialCrypto.js";
import * as rateLimiter from "../utils/rateLimiter.js";
import { normalizePluginResult } from "../utils/pluginResult.js";

const controllers = new Map(); // executionId -> AbortController

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const CREDENTIAL_CACHE_MAX = 100;
const credentialCache = new Map(); // credentialId -> decrypted data

function getCachedCredential(credentialId) {
  return credentialCache.get(credentialId);
}

function setCachedCredential(credentialId, data) {
  if (credentialCache.size >= CREDENTIAL_CACHE_MAX) {
    const firstKey = credentialCache.keys().next().value;
    if (firstKey !== undefined) credentialCache.delete(firstKey);
  }
  credentialCache.set(credentialId, data);
}

function invalidateCredentialCache(credentialId) {
  credentialCache.delete(credentialId);
}

async function resolveCredential(credentialId) {
  const cached = getCachedCredential(credentialId);
  if (cached !== undefined) return cached;
  const doc = await Credential.findById(credentialId).lean();
  if (!doc || !doc.data) return null;
  try {
    const data = decrypt(doc.data);
    setCachedCredential(credentialId, data);
    return data;
  } catch (err) {
    invalidateCredentialCache(credentialId);
    throw err;
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
          credData = await resolveCredential(credentialId);
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
      const executionAttempt = typeof attempt === "number" ? attempt : 0;

      const publishResult = (result) => {
        const errorMessage =
          !result.success
            ? result.meta?.errorMessage ??
              (typeof result.output === "string" ? result.output : undefined) ??
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
        await rateLimiter.check(step.type);
        try {
          const raw = await runExecutor({
            params,
            credentials: credData ?? null,
            previousOutput,
            signal: ctrl.signal
          });

          const durationMs = Date.now() - startAt;
          const result = normalizePluginResult(raw);
          if (!result.meta || typeof result.meta !== "object") result.meta = {};

          result.meta.durationMs = result.meta.durationMs ?? durationMs;
          result.meta.attempt = result.meta.attempt ?? executionAttempt;

          await publishResult(result);
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
        }
      } catch (err) {
        const durationMs = Date.now() - startAt; // best-effort; rate limiter check failure
        const errMsg = err?.message || String(err);
        const resultErr = {
          success: false,
          output: null,
          meta: {
            durationMs,
            status: "error",
            errorMessage: errMsg
          }
        };
        resultErr.meta.attempt = executionAttempt;
        await publishResult(resultErr);
      } finally {
        controllers.delete(executionId);
      }
      channel.ack(msg);
    } catch (err) {
      console.error("Worker step execution error:", err);
      channel.nack(msg, false, true);
    }
  });

  console.log("Worker running...");
}
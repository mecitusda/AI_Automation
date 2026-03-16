import { channel } from "../config/rabbit.js";
import { getPlugin } from "../plugins/registry.js";
import { Credential } from "../models/credential.model.js";
import { decrypt } from "../utils/credentialCrypto.js";
import * as rateLimiter from "../utils/rateLimiter.js";

const controllers = new Map(); // executionId -> AbortController
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
      const { executionId, runId, stepIndex, iteration, step, previousOutput, globalToken, loopStepId } =
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

      try {
        await rateLimiter.check(step.type);
        const runExecutor = plugin.executor ?? plugin.execute;
        const output = await runExecutor({
          params,
          credentials: credData ?? null,
          previousOutput,
          signal: ctrl.signal
        });

        await channel.publish(
          "automation.direct",
          "step.result",
          Buffer.from(JSON.stringify({
            executionId,
            runId,
            stepIndex,
            success: true,
            output,
            previousOutput,
            globalToken,
            iteration,
            loopStepId
          }))
        );
      } catch (err) {
        await channel.publish(
          "automation.direct",
          "step.result",
          Buffer.from(JSON.stringify({
            executionId,
            runId,
            stepIndex,
            success: false,
            error: err?.message || String(err),
            previousOutput,
            globalToken,
            iteration,
            loopStepId
          }))
        );
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
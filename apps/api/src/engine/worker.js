import { channel } from "../config/rabbit.js";
import { plugins } from "../plugins/index.js";

const controllers = new Map(); // executionId -> AbortController

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

    const { executionId, runId, stepIndex, iteration, step, previousOutput, globalToken, loopStepId } =
      JSON.parse(msg.content.toString());

    const plugin = plugins[step.type];
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
          error: `Plugin not found: ${step.type}`,
          previousOutput,
          globalToken
        }))
      );
      return channel.ack(msg);
    }

    const ctrl = new AbortController();
    controllers.set(executionId, ctrl);


    try {
      const output = await plugin.execute({
        params: step.params,
        previousOutput,
        signal: ctrl.signal   // ✅ plugin bunu kullanacak
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
          globalToken ,
          iteration,
          loopStepId
        }))
      );
    } catch (err) {
      await channel.publish(
        "automation.direct",
        "step.result",
        Buffer.from(JSON.stringify({
          executionId, runId, stepIndex,
          success: false,
          error: err?.message || String(err),
          previousOutput,
          globalToken ,
          iteration,
          loopStepId
        }))
      );
    } finally {
      controllers.delete(executionId);
      channel.ack(msg);
    }
  });

  console.log("Worker running...");
}
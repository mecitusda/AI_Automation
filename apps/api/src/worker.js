import { channel } from "./config/rabbit.js";
import { plugins } from "./plugins/index.js";

export async function startWorker() {

  await channel.consume("step.execute.q", async (msg) => {
    if (!msg) return;

    const {
      executionId,
      runId,
      stepIndex,
      step,
      previousOutput
    } = JSON.parse(msg.content.toString());

    try {
      console.log("Executing:", step.type, executionId);

      const plugin = plugins[step.type];
      if (!plugin) {
        throw new Error(`Plugin not found: ${step.type}`);
      }

      const timeoutMs = step.timeout ?? 0;

      let output;

      if (timeoutMs > 0) {
        output = await Promise.race([
          plugin.execute({
            params: step.params,
            previousOutput
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Step timeout")),
              timeoutMs
            )
          )
        ]);
      } else {
        output = await plugin.execute({
          params: step.params,
          previousOutput
        });
      }

      await channel.publish(
        "automation.direct",
        "step.result",
        Buffer.from(JSON.stringify({
          executionId,
          runId,
          stepIndex,
          success: true,
          output,
          previousOutput
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
          error: err.message,
          previousOutput
        }))
      );
    }

    channel.ack(msg);
  });

  console.log("Worker running...");
}
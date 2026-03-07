export async function publishStepExecution({
  channel,
  stepPlain,
  runId,
  stepIndex,
  executionId,
  resolvedParams,
  previousOutput,
  globalToken
}) {
  await channel.publish(
    "automation.direct",
    "step.execute",
    Buffer.from(JSON.stringify({
      executionId,
      runId,
      stepIndex,
      step: { ...stepPlain, params: resolvedParams },
      previousOutput,
      globalToken
    }))
  );
}
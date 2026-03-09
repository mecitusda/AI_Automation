export async function publishStepExecution({
  channel,
  stepPlain,
  runId,
  stepIndex,
  iteration = 0,
  executionId,
  resolvedParams,
  previousOutput,
  globalToken,
  loopStepId
}) {
  await channel.publish(
    "automation.direct",
    "step.execute",
    Buffer.from(JSON.stringify({
      executionId,
      runId,
      stepIndex,
      iteration,
      step: { ...stepPlain, params: resolvedParams },
      previousOutput,
      globalToken,
      loopStepId
    }))
  );
}
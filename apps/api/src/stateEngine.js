import { Run } from "./models/run.model.js";
export async function movePendingToRunning({
  runId,
  stepIndex,
  executionId
}) {
  const res = await Run.updateOne(
    {
      _id: runId,
      [`stepStates.${stepIndex}.status`]: "pending"
    },
    {
      $set: {
        [`stepStates.${stepIndex}.status`]: "running",
        [`stepStates.${stepIndex}.startedAt`]: new Date(),
        [`stepStates.${stepIndex}.executionId`]: executionId
      }
    }
  );

  return res.modifiedCount === 1;
}

export async function moveRetryingToRunning({
  runId,
  stepIndex,
  retryCount,
  executionId
}) {
  const res = await Run.updateOne(
    {
      _id: runId,
      status: "running",
      [`stepStates.${stepIndex}.status`]: "retrying",
      [`stepStates.${stepIndex}.retryCount`]: retryCount
    },
    {
      $set: {
        [`stepStates.${stepIndex}.status`]: "running",
        [`stepStates.${stepIndex}.startedAt`]: new Date(),
        [`stepStates.${stepIndex}.executionId`]: executionId
      }
    }
  );

  return res.modifiedCount === 1;
}
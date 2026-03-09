import { Run } from "../models/run.model.js";

export async function movePendingToRunning({
  runId,
  stepId,
  iteration = 0,
  executionId
}) {
  const res = await Run.updateOne(
    {
      _id: runId,
      status: "running",
      stepStates: {
        $not: {
          $elemMatch: {
            stepId,
            iteration
          }
        }
      }
    },
    {
      $push: {
        stepStates: {
          stepId,
          iteration,
          status: "running",
          executionId,
          retryCount: 0,
          startedAt: new Date()
        }
      }
    }
  );

  return res.modifiedCount === 1;
}

export async function moveRetryingToRunning({
  runId,
  stepId,
  iteration = 0,
  retryCount,
  executionId
}) {
  const res = await Run.updateOne(
    {
      _id: runId,
      status: "running",
      stepStates: {
        $elemMatch: {
          stepId,
          iteration,
          status: "retrying",
          retryCount
        }
      }
    },
    {
      $set: {
        "stepStates.$.status": "running",
        "stepStates.$.executionId": executionId,
        "stepStates.$.startedAt": new Date()
      }
    }
  );

  return res.modifiedCount === 1;
}
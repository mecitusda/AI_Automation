import { Run } from "../models/run.model.js";

export async function movePendingToRunning({
  runId,
  stepId,
  iteration = 0,
  executionId
}) {
  const startedAt = new Date();

  // Replay (and any flow) may already have a pending step state: update it to running.
  const updateExisting = await Run.updateOne(
    {
      _id: runId,
      status: "running",
      stepStates: {
        $elemMatch: {
          stepId,
          iteration,
          status: "pending"
        }
      }
    },
    {
      $set: {
        "stepStates.$.status": "running",
        "stepStates.$.executionId": executionId,
        "stepStates.$.startedAt": startedAt
      }
    }
  );

  if (updateExisting.modifiedCount === 1) return true;

  // No pending state exists (e.g. normal run): push a new running state.
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
          startedAt
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
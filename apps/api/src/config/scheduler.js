import cron from "node-cron";
import { Workflow } from "../models/workflow.model.js";
import { Run } from "../models/run.model.js";
import { channel } from "./rabbit.js";

const activeJobs = new Map();

export async function startScheduler() {
  console.log("Scheduler starting...");

  const workflows = await Workflow.find({
    enabled: true,
    "trigger.type": "cron"
  });

  for (const workflow of workflows) {
    registerCronWorkflow(workflow);
  }
}

export function registerCronWorkflow(workflow) {
  if (!workflow.trigger?.cron) return;

  const id = workflow._id.toString();

  // 🔥 Eğer zaten varsa önce durdur
  if (activeJobs.has(id)) {
    activeJobs.get(id).stop();
    activeJobs.delete(id);
  }

  const job = cron.schedule(workflow.trigger.cron, async () => {
    console.log(`Cron fired for workflow: ${workflow.name}`);

    const existingRunning = await Run.findOne({
      workflowId: workflow._id,
      status: { $in: ["running", "queued"] }
    });

    if (existingRunning) {
      console.log(`Skipping workflow ${workflow.name} (already running)`);
      return;
    }

    const run = await Run.create({
      workflowId: workflow._id,
      status: "queued",
      currentStepIndex: 0,
      stepStates: [],
      logs: [],
      processedMessages: [],
      workflowVersion: workflow.currentVersion,
      outputs: new Map(),
      createdAt: new Date()
    });

    await channel.publish(
      "automation.direct",
      "run.start",
      Buffer.from(JSON.stringify({
        runId: run._id.toString()
      }))
    );
  });

  activeJobs.set(id, job);
}

export function stopCronWorkflow(workflowId) {
  const job = activeJobs.get(workflowId);
  if (job) {
    job.stop();
    activeJobs.delete(workflowId);
  }
}
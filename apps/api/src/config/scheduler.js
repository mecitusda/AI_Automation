import cron from "node-cron";
import { Workflow } from "../models/workflow.model.js";
import { Run } from "../models/run.model.js";
import { channel } from "./rabbit.js";
import { logInfo } from "../utils/logger.js";

const activeJobs = new Map();

export async function startScheduler() {
  logInfo("scheduler.starting", { message: "Scheduler starting..." });

  const workflows = await Workflow.find({
    enabled: true,
    "trigger.type": "cron"
  });

  for (const workflow of workflows) {
    registerCronWorkflow(workflow);
  }
}

export function registerCronWorkflow(workflow) {
  const cronExpression = workflow.trigger?.cron || workflow.trigger?.schedule;
  if (!cronExpression) return;

  const id = workflow._id.toString();

  // 🔥 Eğer zaten varsa önce durdur
  if (activeJobs.has(id)) {
    activeJobs.get(id).stop();
    activeJobs.delete(id);
  }

  const scheduleOptions = {};
  if (workflow.trigger?.timezone) {
    scheduleOptions.timezone = workflow.trigger.timezone;
  }

  const job = cron.schedule(cronExpression, async () => {
    logInfo("scheduler.cron.trigger", {
      workflowId: workflow._id?.toString(),
      message: `Trigger fired for workflow ${workflow.name}`
    });

    const existingRunning = await Run.findOne({
      workflowId: workflow._id,
      status: { $in: ["running", "queued"] }
    });

    if (existingRunning) {
      logInfo("scheduler.cron.skip_running", {
        workflowId: workflow._id?.toString(),
        message: `Skipping workflow ${workflow.name} (already running)`
      });
      return;
    }

    const run = await Run.create({
      userId: workflow.userId,
      workflowId: workflow._id,
      workflowVersion: workflow.currentVersion ?? 1,
      status: "queued",
      triggerPayload: { triggeredBy: "cron" }
    });

    await channel.publish(
      "automation.direct",
      "run.start",
      Buffer.from(JSON.stringify({ runId: run._id.toString() }))
    );
  }, Object.keys(scheduleOptions).length ? scheduleOptions : undefined);

  activeJobs.set(id, job);
}

export function stopCronWorkflow(workflowId) {
  const job = activeJobs.get(workflowId);
  if (job) {
    job.stop();
    activeJobs.delete(workflowId);
  }
}
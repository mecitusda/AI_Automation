import cron from "node-cron";
import { channel } from "./rabbit.js";
import { logInfo } from "../utils/logger.js";
import { getPlatformModels } from "../utils/tenantModels.js";

const activeJobs = new Map();

export async function startScheduler() {
  logInfo("scheduler.starting", { message: "Scheduler starting..." });
  const { Workflow } = getPlatformModels();
  const workflows = await Workflow.find({ enabled: true, "trigger.type": "cron" });
  for (const workflow of workflows) {
    registerCronWorkflow(workflow);
  }
}

export function registerCronWorkflow(workflow) {
  const cronExpression = workflow.trigger?.cron || workflow.trigger?.schedule;
  if (!cronExpression) return;
  const { Run } = getPlatformModels();
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
  const direct = activeJobs.get(workflowId);
  if (direct) {
    direct.stop();
    activeJobs.delete(workflowId);
  }
  for (const [key, job] of activeJobs.entries()) {
    if (key === workflowId || key.endsWith(`:${workflowId}`)) {
      job.stop();
      activeJobs.delete(key);
    }
  }
}
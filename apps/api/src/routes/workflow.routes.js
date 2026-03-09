import express from "express";
import { Workflow } from "../models/workflow.model.js";
import { Run } from "../models/run.model.js";
import { channel } from "../config/rabbit.js";
import { registerCronWorkflow, stopCronWorkflow  } from "../config/scheduler.js";
import { plugins } from "../plugins/index.js";
const router = express.Router();


// GET

router.get("/:id/versions", async (req, res) => {
  try {
    const wf = await Workflow.findById(req.params.id);
    if (!wf) return res.status(404).json({ error: "Workflow not found" });

    const versions = (wf.versions || [])
      .slice()
      .sort((a, b) => a.version - b.version)
      .map(v => ({
        version: v.version,
        stepCount: v.steps?.length ?? 0,
        maxParallel: v.maxParallel ?? 5,
        createdAt: v.createdAt
      }));

    res.json({ workflowId: wf._id.toString(), currentVersion: wf.currentVersion, versions });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const wf = await Workflow.findById(req.params.id);
    if (!wf) return res.status(404).json({ error: "Not found" });

    res.json({
      id: wf._id.toString(),
      name: wf.name,
      enabled: wf.enabled,
      currentVersion: wf.currentVersion,
      maxParallel: wf.maxParallel,
      trigger: wf.trigger?.type ?? "manual",
      steps: wf.steps
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/", async (_req, res) => {
  const workflows = await Workflow.find().sort({ createdAt: -1 });

  res.json(
    workflows.map(w => ({
      id: w._id.toString(),
      name: w.name,
      enabled: w.enabled,
      currentVersion: w.currentVersion,
      stepCount: w.steps?.length ?? 0,
      trigger: w.trigger?.type
    }))
  );
});

// POsT

router.post("/:id/rollback/:version", async (req, res) => {
  try {
    const { id, version } = req.params;
    const targetVersion = Number(version);
    const wf = await Workflow.findById(id);
    if (!wf) return res.status(404).json({ error: "Workflow not found" });

    // versions init (legacy safety)
    if (!wf.versions || wf.versions.length === 0) {
      wf.versions = [{
        version: wf.currentVersion || 1,
        steps: wf.steps ?? [],
        maxParallel: wf.maxParallel ?? 5,
        createdAt: new Date()
      }];
      wf.currentVersion = wf.currentVersion || 1;
    }

    const snap = wf.versions.find(v => v.version === targetVersion);
    if (!snap) {
      return res.status(404).json({ error: `Version ${targetVersion} not found` });
    }

    const oldTriggerType = wf.trigger?.type;
    const oldEnabled = wf.enabled;

    // ✅ rollback
    wf.currentVersion = targetVersion;
    console.log(wf.currentVersion)
    // UI + legacy convenience: active snapshot sync
    wf.steps = snap.steps;
    wf.maxParallel = snap.maxParallel ?? wf.maxParallel ?? 5;

    const updated = await wf.save();

    // ✅ cron reconcile (aynı mantığı rollback sonrası da uygula)
    const nowTriggerType = updated.trigger?.type;
    const nowEnabled = updated.enabled;

    // cron'dan çıktıysa veya disabled olduysa durdur
    if (oldTriggerType === "cron" && (!nowEnabled || nowTriggerType !== "cron")) {
      stopCronWorkflow(updated._id.toString());
    }

    // cron + enabled ise yeniden register
    if (nowEnabled && nowTriggerType === "cron") {
      stopCronWorkflow(updated._id.toString());
      registerCronWorkflow(updated);
    }

    res.json({
      ok: true,
      workflowId: updated._id.toString(),
      currentVersion: updated.currentVersion
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /workflows/{id}/run:
 *   post:
 *     summary: Trigger workflow manually
 *     tags: [Workflows]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Workflow ID
 *     responses:
 *       200:
 *         description: Workflow run started
 *       404:
 *         description: Workflow not found
 */
router.post("/:id/run", async (req, res) => {
  try {
    const workflow = await Workflow.findById(req.params.id);

    if (!workflow) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    const run = await Run.create({
      workflowId: workflow._id,
      workflowVersion: workflow.currentVersion,
      status: "queued"
    });

    // RabbitMQ'ya mesaj atıyoruz
    await channel.publish(
      "automation.direct",
      "run.start",
      Buffer.from(JSON.stringify({ runId: run._id.toString() }))
    );

    res.json({ message: "Run started", runId: run._id });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /workflows:
 *   post:
 *     summary: Create a new workflow
 *     description: Creates a workflow definition that can be executed manually or via cron trigger.
 *     tags: [Workflows]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - trigger
 *               - steps
 *             properties:
 *               name:
 *                 type: string
 *                 example: Daily GitHub Report
 *               trigger:
 *                 type: object
 *                 required:
 *                   - type
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [manual, cron]
 *                     example: manual
 *                   cron:
 *                     type: string
 *                     example: "0 9 * * *"
 *               steps:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required:
 *                     - id
 *                     - type
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: step1
 *                     type:
 *                       type: string
 *                       example: http.request
 *                     params:
 *                       type: object
 *                       example:
 *                         url: https://api.github.com/repos/nodejs/node/issues
 *     responses:
 *       200:
 *         description: Workflow successfully created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 enabled:
 *                   type: boolean
 *       400:
 *         description: Validation error
 */
router.post("/", async (req, res) => {
  try {

    const {
      name,
      steps = [],
      maxParallel = 5,
      trigger = { type: "manual" },
      enabled = true
    } = req.body;

    if (!name) {
      throw new Error("Workflow name is required");
    }

    if (!Array.isArray(steps)) {
      throw new Error("Steps must be an array");
    }

    /* 🔹 STEP VALIDATION */

    for (const step of steps) {

      if (!step.id) {
        throw new Error("Step id is required");
      }

      if (!step.type) {
        throw new Error(`Step ${step.id} missing type`);
      }
      if (!plugins[step.type] && !["if", "foreach"].includes(step.type)) {
        throw new Error(`Plugin not found: ${step.type}`);
      }

    }

    /* 🔹 CREATE WORKFLOW */

    const workflow = await Workflow.create({
      name,
      steps,
      maxParallel,
      trigger,
      enabled,

      currentVersion: 1,

      versions: [
        {
          version: 1,
          steps,
          maxParallel,
          createdAt: new Date()
        }
      ]
    });

    /* 🔹 CRON REGISTER */

    if (workflow.enabled && workflow.trigger?.type === "cron") {
      registerCronWorkflow(workflow);
    }

    /* 🔹 EVENT */

    await channel.publish(
      "automation.direct",
      "workflow.created",
      Buffer.from(
        JSON.stringify({
          workflowId: workflow._id.toString()
        })
      )
    );

    res.json(workflow);

  } catch (err) {

    res.status(400).json({
      error: err.message
    });

  }
});

// PUT 

/**
 * @swagger
 * /workflows/{id}:
 *   put:
 *     summary: Update workflow
 *     tags: [Workflows]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Workflow ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               steps:
 *                 type: array
 *                 items:
 *                   type: object
 *               maxParallel:
 *                 type: number
 *               trigger:
 *                 type: object
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [manual, cron]
 *                   cron:
 *                     type: string
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Workflow updated
 *       404:
 *         description: Workflow not found
 */
router.put("/:id", async (req, res) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    const oldTriggerType = workflow.trigger?.type;
    const oldEnabled = workflow.enabled;

    const {
      steps,
      maxParallel,
      name,
      enabled,
      trigger,
      ...rest
    } = req.body || {};

    // ---- META UPDATE ----
    if (name !== undefined) workflow.name = name;
    if (enabled !== undefined) workflow.enabled = enabled;
    if (trigger !== undefined) workflow.trigger = trigger;

    Object.assign(workflow, rest);

    // ---- VERSION INIT (LEGACY SUPPORT) ----
    if (!workflow.versions || workflow.versions.length === 0) {
      workflow.versions = [{
        version: 1,
        steps: workflow.steps ?? [],
        maxParallel: workflow.maxParallel ?? 5,
        createdAt: new Date()
      }];
      workflow.currentVersion = 1;
    }

    const currentDef = workflow.versions.find(
      v => v.version === workflow.currentVersion
    );

    const stepsChanged =
      steps !== undefined &&
      JSON.stringify(steps) !== JSON.stringify(currentDef.steps);

    const parallelChanged =
      maxParallel !== undefined &&
      maxParallel !== currentDef.maxParallel;

    if (stepsChanged || parallelChanged) {
      const nextVersion = workflow.currentVersion + 1;

      const nextSteps = stepsChanged ? steps : currentDef.steps;
      const nextParallel = parallelChanged ? maxParallel : currentDef.maxParallel;

      workflow.versions.push({
        version: nextVersion,
        steps: nextSteps,
        maxParallel: nextParallel,
        createdAt: new Date()
      });

      workflow.currentVersion = nextVersion;

      // active snapshot sync
      workflow.steps = nextSteps;
      workflow.maxParallel = nextParallel;
    }

    const updated = await workflow.save();

    // ---- CRON LOGIC ----
    if (
      oldTriggerType === "cron" &&
      (!updated.enabled || updated.trigger?.type !== "cron")
    ) {
      stopCronWorkflow(updated._id.toString());
    }

    if (updated.enabled && updated.trigger?.type === "cron") {
      stopCronWorkflow(updated._id.toString());
      registerCronWorkflow(updated);
    }

    res.json(updated);

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// DELETE 

router.delete("/:id", async (req, res) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    stopCronWorkflow(workflow._id.toString());

    await workflow.deleteOne();

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
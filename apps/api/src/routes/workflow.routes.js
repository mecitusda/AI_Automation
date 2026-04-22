import express from "express";
import { Workflow } from "../models/workflow.model.js";
import { Run } from "../models/run.model.js";
import { channel } from "../config/rabbit.js";
import { registerCronWorkflow, stopCronWorkflow  } from "../config/scheduler.js";
import { validateWorkflowPayload } from "../utils/validateWorkflow.js";
import { workflowVersionDiff } from "../utils/workflowDiff.js";
const router = express.Router();
const ownedWorkflowQuery = (req, id) => ({ _id: id, userId: req.user.id });


// GET

router.get("/:id/versions/diff", async (req, res) => {
  try {
    const fromV = Number(req.query.from);
    const toV = Number(req.query.to);
    if (!Number.isInteger(fromV) || !Number.isInteger(toV)) {
      return res.status(400).json({ error: "Query from and to must be version numbers" });
    }
    const wf = await Workflow.findOne(ownedWorkflowQuery(req, req.params.id));
    if (!wf) return res.status(404).json({ error: "Workflow not found" });

    const fromSnap = wf.versions?.find((v) => v.version === fromV);
    const toSnap = wf.versions?.find((v) => v.version === toV);
    if (!fromSnap) return res.status(404).json({ error: `Version ${fromV} not found` });
    if (!toSnap) return res.status(404).json({ error: `Version ${toV} not found` });

    const { added, removed, changed } = workflowVersionDiff(fromSnap.steps || [], toSnap.steps || []);
    return res.json({ fromVersion: fromV, toVersion: toV, added, removed, changed });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get("/:id/versions", async (req, res) => {
  try {
    const wf = await Workflow.findOne(ownedWorkflowQuery(req, req.params.id));
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
    const wf = await Workflow.findOne(ownedWorkflowQuery(req, req.params.id));
    if (!wf) return res.status(404).json({ error: "Not found" });

    res.json({
      id: wf._id.toString(),
      name: wf.name,
      enabled: wf.enabled,
      currentVersion: wf.currentVersion,
      maxParallel: wf.maxParallel,
      trigger: wf.trigger ?? { type: "manual" },
      steps: wf.steps
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /workflows/:id/steps/:stepId/output-preview
 * Returns the step output from the latest completed/failed run for the workflow.
 * Used by the editor to show "Preview output structure".
 */
router.get("/:id/steps/:stepId/output-preview", async (req, res) => {
  try {
    const { id: workflowId, stepId } = req.params;
    const run = await Run.findOne({
      userId: req.user.id,
      workflowId,
      status: { $in: ["completed", "failed"] }
    })
      .sort({ createdAt: -1 })
      .limit(1)
      .lean();

    if (!run) {
      // For editor preview: returning null avoids 404 console spam.
      return res.json(null);
    }

    const outputs = run.outputs || {};
    const stepOutput = outputs[stepId];
    if (stepOutput == null) {
      // For editor preview: returning null avoids 404 console spam.
      return res.json(null);
    }

    const firstIteration = typeof stepOutput === "object" && !Array.isArray(stepOutput)
      ? stepOutput["0"] ?? stepOutput[Object.keys(stepOutput)[0]]
      : stepOutput;

    return res.json(firstIteration);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

router.get("/", async (req, res) => {
  const workflows = await Workflow.find({ userId: req.user.id }).sort({ createdAt: -1 });

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
    const wf = await Workflow.findOne(ownedWorkflowQuery(req, id));
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
    const workflow = await Workflow.findOne(ownedWorkflowQuery(req, req.params.id));

    if (!workflow) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    let workflowVersion = workflow.currentVersion;
    const bodyVersion = req.body?.workflowVersion;
    const triggerPayloadRaw = req.body?.triggerPayload ?? req.body?.input;
    if (bodyVersion != null && bodyVersion !== "") {
      const v = Number(bodyVersion);
      const hasVersion = workflow.versions?.some((ver) => ver.version === v) || v === workflow.currentVersion;
      if (!Number.isInteger(v) || !hasVersion) {
        return res.status(400).json({ error: "Invalid or unknown workflow version" });
      }
      workflowVersion = v;
    }
    if (
      triggerPayloadRaw != null &&
      (typeof triggerPayloadRaw !== "object" || Array.isArray(triggerPayloadRaw))
    ) {
      return res.status(400).json({ error: "triggerPayload must be an object" });
    }

    const run = await Run.create({
      userId: req.user.id,
      workflowId: workflow._id,
      workflowVersion,
      status: "queued",
      triggerPayload: triggerPayloadRaw ?? undefined
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

    const validated = validateWorkflowPayload(req.body);

    /* 🔹 CREATE WORKFLOW */

    const workflow = await Workflow.create({
      name: validated.name,
      steps: validated.steps,
      maxParallel: validated.maxParallel,
      trigger: validated.trigger,
      enabled: validated.enabled,
      userId: req.user.id,

      currentVersion: 1,

      versions: [
        {
          version: 1,
          steps: validated.steps,
          maxParallel: validated.maxParallel,
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

/**
 * Validate variables for a workflow definition.
 * POST /workflows/:id/validate-variables
 * Body: { steps?: Step[] } (optional; if omitted, uses current workflow definition)
 * Returns: { variables: { path: string; ok: boolean; error?: string }[] }
 */
router.post("/:id/validate-variables", async (req, res) => {
  try {
    const { id } = req.params;
    const wf = await Workflow.findOne(ownedWorkflowQuery(req, id)).lean();
    if (!wf) return res.status(404).json({ error: "Workflow not found" });

    // Use provided steps if any, otherwise current workflow steps
    const steps = Array.isArray(req.body?.steps) && req.body.steps.length > 0
      ? req.body.steps
      : (wf.steps || []);

    const stepIds = new Set(steps.map((s) => s.id));
    const vars = [];
    const VAR_REGEX = /\{\{\s*([^}]+?)\s*\}\}/g;

    for (const step of steps) {
      const params = step.params || {};
      for (const [key, value] of Object.entries(params)) {
        if (typeof value !== "string") continue;
        const str = value;
        let match;
        const seen = new Set();
        while ((match = VAR_REGEX.exec(str)) !== null) {
          const expr = match[1].trim();
          if (!expr || seen.has(expr)) continue;
          seen.add(expr);

          const parts = expr.split(".").filter(Boolean);
          if (parts.length === 0) {
            vars.push({ path: expr, ok: false, error: "Empty variable expression" });
            continue;
          }

          // Basic root validation
          const root = parts[0];
          if (!["trigger", "steps", "loop", "run", "error"].includes(root)) {
            vars.push({ path: expr, ok: false, error: `Unknown root "${root}" in variable "${expr}"` });
            continue;
          }

          if (root === "steps") {
            const stepId = parts[1];
            if (!stepId) {
              vars.push({ path: expr, ok: false, error: `Step id missing in "${expr}"` });
              continue;
            }
            if (!stepIds.has(stepId)) {
              vars.push({ path: expr, ok: false, error: `Unknown step "${stepId}" in "${expr}"` });
              continue;
            }
          }

          if (root === "loop") {
            const seg = parts[1];
            if (!["item", "index"].includes(seg || "")) {
              vars.push({ path: expr, ok: false, error: `Loop variable must start with item or index in "${expr}"` });
              continue;
            }
          }

          // For now, nested keys are not deeply validated here
          vars.push({ path: expr, ok: true });
        }
      }
    }

    res.json({ variables: vars });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const workflow = await Workflow.findOne(ownedWorkflowQuery(req, req.params.id));
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
    const workflow = await Workflow.findOne(ownedWorkflowQuery(req, req.params.id));
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
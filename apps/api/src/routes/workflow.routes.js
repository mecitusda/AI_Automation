import express from "express";
import { Workflow } from "../models/workflow.model.js";
import { Run } from "../models/run.model.js";
import { channel } from "../config/rabbit.js";
import { registerCronWorkflow, stopCronWorkflow  } from "../config/scheduler.js";

const router = express.Router();

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
    console.log("Creating workflow:", req.body);
    const workflow = await Workflow.create(req.body);
    if (workflow.enabled && workflow.trigger?.type === "cron") {
      registerCronWorkflow(workflow);
    }
    res.json(workflow);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});




router.get("/", async (req, res) => {
  const workflows = await Workflow.find();
  res.json(workflows);
});


router.put("/:id", async (req, res) => {
  try {
    const existing = await Workflow.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    const updated = await Workflow.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    const id = updated._id.toString();

    // Eğer eskisi cron idiyse ama artık değilse → durdur
    if (
      existing.trigger?.type === "cron" &&
      (!updated.enabled || updated.trigger?.type !== "cron")
    ) {
      stopCronWorkflow(id);
    }

    // Eğer cron ve enabled ise → yeniden register
    if (updated.enabled && updated.trigger?.type === "cron") {
      stopCronWorkflow(id); // varsa önce temizle
      registerCronWorkflow(updated);
    }

    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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
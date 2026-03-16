/**
 * Compute transitive ancestors of fromStepId in the dependency graph.
 * @param {Array<{ id: string, dependsOn?: string[] }>} steps
 * @param {string} fromStepId
 * @returns {Set<string>} set of step ids that are ancestors of fromStepId
 */
export function computeAncestors(steps, fromStepId) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const ancestors = new Set();
  const queue = [fromStepId];

  while (queue.length > 0) {
    const id = queue.shift();
    const step = byId.get(id);
    if (!step || !step.dependsOn?.length) continue;
    for (const depId of step.dependsOn) {
      if (!ancestors.has(depId)) {
        ancestors.add(depId);
        queue.push(depId);
      }
    }
  }
  return ancestors;
}

/**
 * Create a new run document for replay from sourceRun, starting from fromStepId.
 * Ancestors get completed state and copied outputs; fromStepId and descendants get pending.
 * @param {object} sourceRun - Run document (lean) with workflowSnapshot, outputs, stepStates, triggerPayload
 * @param {string} fromStepId
 * @returns {object} plain object suitable for Run.create()
 */
export function createReplayRun(sourceRun, fromStepId) {
  const steps = sourceRun.workflowSnapshot?.steps ?? [];
  const ancestors = computeAncestors(steps, fromStepId);

  const outputs = new Map();
  const stepStates = [];
  const loopState = new Map();

  for (const step of steps) {
    const stepId = step.id;
    const isAncestor = ancestors.has(stepId);

    if (isAncestor) {
      const srcOutputs = sourceRun.outputs;
      if (srcOutputs) {
        const get = typeof srcOutputs.get === "function" ? (k) => srcOutputs.get(k) : (k) => srcOutputs[k];
        const keys = typeof srcOutputs.keys === "function" ? [...srcOutputs.keys()] : Object.keys(srcOutputs);
        for (const key of keys) {
          if (key === stepId || key.startsWith(stepId + ".")) {
            const val = get(key);
            if (val !== undefined) outputs.set(key, val);
          }
        }
      }
      const srcStates = sourceRun.stepStates ?? [];
      const state = srcStates.find((s) => s.stepId === stepId);
      if (state) {
        stepStates.push({
          stepId: state.stepId,
          iteration: state.iteration ?? 0,
          executionId: state.executionId,
          retryCount: state.retryCount ?? 0,
          status: "completed",
          startedAt: state.startedAt,
          finishedAt: state.finishedAt,
          durationMs: state.durationMs,
        });
      }
      if (step.type === "foreach" && sourceRun.loopState) {
        const srcLoop = typeof sourceRun.loopState.get === "function"
          ? sourceRun.loopState.get(stepId)
          : sourceRun.loopState[stepId];
        if (srcLoop) loopState.set(stepId, srcLoop);
      }
    } else {
      stepStates.push({
        stepId,
        iteration: 0,
        status: "pending",
      });
    }
  }

  const triggerPayload = sourceRun.triggerPayload
    ? (typeof sourceRun.triggerPayload.toObject === "function"
      ? sourceRun.triggerPayload.toObject()
      : { ...sourceRun.triggerPayload })
    : {};

  const workflowSnapshot = sourceRun.workflowSnapshot
    ? (typeof sourceRun.workflowSnapshot.toObject === "function"
      ? sourceRun.workflowSnapshot.toObject()
      : { ...sourceRun.workflowSnapshot, steps: [...(sourceRun.workflowSnapshot.steps || [])] })
    : { steps: [], maxParallel: 5, version: sourceRun.workflowVersion };

  return {
    workflowId: sourceRun.workflowId,
    workflowVersion: sourceRun.workflowVersion,
    status: "queued",
    triggerPayload,
    processedMessages: [],
    outputs: Object.fromEntries(outputs),
    stepStates,
    loopState: Object.fromEntries(loopState),
    loopContext: {},
    workflowSnapshot,
  };
}

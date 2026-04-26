import { plugins } from "../plugins/index.js";

/**
 * Build adjacency list: stepId -> list of step ids this step depends on (outgoing).
 */
function buildGraph(steps) {
  const stepIds = new Set(steps.map((s) => s.id));
  const graph = new Map();
  for (const step of steps) {
    const deps = (step.dependsOn || []).filter((d) => stepIds.has(d));
    graph.set(step.id, deps);
  }
  return { graph, stepIds };
}

function normalizeDependencyModesObject(raw) {
  if (!raw || typeof raw !== "object") return {};
  if (raw instanceof Map) {
    return Object.fromEntries(raw.entries());
  }
  return { ...raw };
}

/**
 * Detect cycle in dependency graph using DFS.
 * @returns {string[]} list of step ids in a cycle, or empty if acyclic
 */
function findCycle(steps) {
  const { graph, stepIds } = buildGraph(steps);
  const visited = new Set();
  const recStack = new Set();
  const path = [];
  const pathIndex = new Map();

  function dfs(stepId) {
    visited.add(stepId);
    recStack.add(stepId);
    path.push(stepId);
    pathIndex.set(stepId, path.length - 1);

    const nextIds = graph.get(stepId) || [];
    for (const next of nextIds) {
      if (!visited.has(next)) {
        const cycle = dfs(next);
        if (cycle.length) return cycle;
      } else if (recStack.has(next)) {
        const start = pathIndex.get(next);
        return path.slice(start);
      }
    }
    path.pop();
    pathIndex.delete(stepId);
    recStack.delete(stepId);
    return [];
  }

  for (const id of stepIds) {
    if (!visited.has(id)) {
      const cycle = dfs(id);
      if (cycle.length) return cycle;
    }
  }
  return [];
}

/**
 * Validate workflow graph: no cycles, at least one start node, foreach has dependent.
 * @throws {Error} with message describing the failure
 */
export function validateWorkflowGraph(steps) {
  if (!steps || steps.length === 0) {
    throw new Error("Workflow must have at least one step");
  }
  const cycle = findCycle(steps);
  if (cycle.length > 0) {
    throw new Error(`Cycle detected: ${cycle.join(" → ")}`);
  }
  const stepIds = new Set(steps.map((s) => s.id));
  const hasNoDeps = steps.some((s) => !s.dependsOn || s.dependsOn.length === 0);
  if (!hasNoDeps) {
    throw new Error("Workflow must have at least one start node (step with no dependencies)");
  }
  for (const step of steps) {
    if (step.type === "foreach") {
      const hasDependent = steps.some(
        (s) => s.id !== step.id && s.dependsOn && s.dependsOn.includes(step.id)
      );
      if (!hasDependent) {
        throw new Error(`Foreach step "${step.id}" must have at least one step that depends on it`);
      }
    }
  }
  const byId = new Map(steps.map((s) => [s.id, s]));
  for (const step of steps) {
    const dependsOn = Array.isArray(step.dependsOn) ? step.dependsOn : [];
    const dependencyModes = normalizeDependencyModesObject(step.dependencyModes);
    for (const [depId, mode] of Object.entries(dependencyModes)) {
      if (!dependsOn.includes(depId)) {
        throw new Error(
          `Step "${step.id}" has dependencyModes["${depId}"] but does not depend on "${depId}"`
        );
      }
      if (mode !== "iteration" && mode !== "barrier") {
        throw new Error(
          `Step "${step.id}" has invalid dependency mode "${String(mode)}" for "${depId}"`
        );
      }
      const depStep = byId.get(depId);
      if (mode === "iteration" && depStep?.type !== "foreach") {
        throw new Error(
          `Step "${step.id}" can use iteration mode only for foreach dependency "${depId}"`
        );
      }
    }
  }
}

export function normalizeWorkflowSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((step) => ({
    ...step,
    dependencyModes: normalizeDependencyModesObject(step?.dependencyModes),
  }));
}

/**
 * Validate workflow payload (name, steps, maxParallel, trigger).
 * Throws with message on validation failure.
 * Variable validation is not performed here; invalid variables are reported at runtime when resolving context.
 * @param {{ name?: string; steps?: unknown[]; maxParallel?: number; trigger?: object; enabled?: boolean }} body
 * @returns {{ name: string; steps: object[]; maxParallel: number; trigger: object; enabled: boolean }}
 */
export function validateWorkflowPayload(body) {
  const {
    name,
    steps = [],
    maxParallel = 5,
    trigger = { type: "manual" },
    enabled = true
  } = body || {};

  if (!name || typeof name !== "string") {
    throw new Error("Workflow name is required");
  }
  if (!Array.isArray(steps)) {
    throw new Error("Steps must be an array");
  }
  const normalizedSteps = normalizeWorkflowSteps(steps);
  for (const step of normalizedSteps) {
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

  if (normalizedSteps.length > 0) {
    validateWorkflowGraph(normalizedSteps);
  }

  return {
    name: String(name),
    steps: normalizedSteps,
    maxParallel: Number(maxParallel) || 5,
    trigger: trigger && typeof trigger === "object" ? trigger : { type: "manual" },
    enabled: Boolean(enabled)
  };
}

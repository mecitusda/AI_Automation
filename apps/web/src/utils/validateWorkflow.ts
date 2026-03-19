import type { WorkflowDetail } from "../api/workflow";
import { validateNodeParams } from "../nodes";
import { parseVariables, validateVariable } from "./variableSystem";

export type WorkflowValidationResult = {
  valid: boolean;
  errors: string[];
  stepErrors: Record<string, Record<string, string>>;
  warnings: string[];
  stepWarnings: Record<string, Record<string, string>>;
};

function buildGraph(steps: { id: string; dependsOn?: string[] }[]) {
  const stepIds = new Set(steps.map((s) => s.id));
  const graph = new Map<string, string[]>();
  for (const step of steps) {
    const deps = (step.dependsOn || []).filter((d) => stepIds.has(d));
    graph.set(step.id, deps);
  }
  return { graph, stepIds };
}

function findCycle(steps: { id: string; dependsOn?: string[] }[]): string[] {
  const { graph, stepIds } = buildGraph(steps);
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];
  const pathIndex = new Map<string, number>();

  function dfs(stepId: string): string[] {
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
        const start = pathIndex.get(next) ?? 0;
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

export function validateWorkflow(steps: WorkflowDetail["steps"]): WorkflowValidationResult {
  const errors: string[] = [];
  const stepErrors: Record<string, Record<string, string>> = {};
  const warnings: string[] = [];
  const stepWarnings: Record<string, Record<string, string>> = {};

  if (!steps || steps.length === 0) {
    return {
      valid: false,
      errors: ["Workflow must have at least one step"],
      stepErrors: {},
      warnings: [],
      stepWarnings: {},
    };
  }

  const cycle = findCycle(steps);
  if (cycle.length > 0) {
    errors.push(`Cycle detected: ${cycle.join(" → ")}`);
  }

  const hasStart = steps.some((s) => !s.dependsOn || s.dependsOn.length === 0);
  if (!hasStart) {
    errors.push("Workflow must have at least one start node (step with no dependencies)");
  }

  for (const step of steps) {
    if (step.type === "foreach") {
      const hasDependent = steps.some(
        (s) => s.id !== step.id && s.dependsOn?.includes(step.id)
      );
      if (!hasDependent) {
        errors.push(`Foreach step "${step.id}" must have at least one step that depends on it`);
      }
    }

    const paramErrs = validateNodeParams(step.type, step.params ?? {});

    const context = {
      steps: steps.map((s) => ({ id: s.id, type: s.type })),
      currentStepId: step.id,
    };
    const variableWarningsForStep: Record<string, string> = {};

    for (const [key, value] of Object.entries(step.params ?? {})) {
      if (typeof value !== "string") continue;
      const paths = parseVariables(value as string);
      const seen = new Set<string>();
      for (const path of paths) {
        if (seen.has(path)) continue;
        seen.add(path);
        const result = validateVariable(path, context);
        const message = result.warning ?? (result.valid ? undefined : "Invalid variable");
        if (message) {
          variableWarningsForStep[key] = message;
          warnings.push(`${step.id}.${key}: ${message}`);
          break;
        }
      }
    }

    if (Object.keys(variableWarningsForStep).length > 0) {
      stepWarnings[step.id] = variableWarningsForStep;
    }
    if (Object.keys(paramErrs).length > 0) {
      stepErrors[step.id] = paramErrs;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    stepErrors,
    warnings,
    stepWarnings,
  };
}

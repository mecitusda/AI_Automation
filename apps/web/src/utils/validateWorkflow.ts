import type { WorkflowDetail } from "../api/workflow";
import { validateNodeParams } from "../nodes";
import { validateVariablePath } from "./variableSystem";

export type WorkflowValidationResult = {
  valid: boolean;
  errors: string[];
  stepErrors: Record<string, Record<string, string>>;
};

const VARIABLE_EXPR_REGEX = /\{\{\s*([^}]+?)\s*\}\}/g;

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

  if (!steps || steps.length === 0) {
    return { valid: false, errors: ["Workflow must have at least one step"], stepErrors: {} };
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
    const variableErrs: Record<string, string> = {};

    // Variable-level validation: scan string fields for {{ ... }} expressions
    for (const [key, value] of Object.entries(step.params ?? {})) {
      if (typeof value !== "string") continue;
      const str = value as string;
      let match: RegExpExecArray | null;
      const seenForField = new Set<string>();
      while ((match = VARIABLE_EXPR_REGEX.exec(str)) !== null) {
        const expr = match[1];
        if (!expr || seenForField.has(expr)) continue;
        seenForField.add(expr);
        const result = validateVariablePath(expr, {
          steps: steps.map((s) => ({ id: s.id, type: s.type })),
          currentStepId: step.id,
        });
        if (!result.ok && result.error) {
          variableErrs[key] = result.error;
          errors.push(`${step.id}.${key}: ${result.error}`);
          // Only record first error per field for now
          break;
        }
      }
    }

    const combinedErrs =
      Object.keys(variableErrs).length > 0 ? { ...paramErrs, ...variableErrs } : paramErrs;

    if (Object.keys(combinedErrs).length > 0) {
      stepErrors[step.id] = combinedErrs;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    stepErrors,
  };
}

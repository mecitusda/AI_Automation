import type { WorkflowDetail } from "../api/workflow";
import type { PluginHandles } from "../api/plugins";

/** Read-only graph: most executor steps use default + error output (matches editor `DEFAULT_HANDLES`). */
export const READONLY_DEFAULT_PLUGIN_HANDLES: PluginHandles = {
  inputs: [{ id: "default" }],
  outputs: [{ id: "default" }],
  errorOutput: true,
};

export const READONLY_IF_HANDLES: PluginHandles = {
  inputs: [{ id: "default" }],
  outputs: [{ id: "true" }, { id: "false" }],
  errorOutput: true,
};

export type StepLike = { id: string; type?: string; errorFrom?: string; branch?: string; dependsOn?: string[] };

export function stepHasOutgoingErrorPort(steps: StepLike[], parentStepId: string): boolean {
  return steps.some((s) => s.errorFrom === parentStepId);
}

/**
 * React Flow needs explicit `sourceHandle` when a node has multiple source handles;
 * otherwise success and error edges both attach to the same point.
 */
export function resolveDependsOnSourceHandle(opts: {
  isErrorEdge: boolean;
  isSwitchBranch: boolean;
  branchHandle: string | undefined;
  sourceStepType: string | undefined;
  parentHasErrorPort: boolean;
}): string | undefined {
  if (opts.isErrorEdge) return "error";
  if (opts.isSwitchBranch && opts.branchHandle && String(opts.branchHandle).trim() !== "") {
    return String(opts.branchHandle).trim();
  }
  if (opts.parentHasErrorPort && opts.sourceStepType && opts.sourceStepType !== "if") {
    return "default";
  }
  return undefined;
}

/** Normalize React Flow connection handle id (error port is `"error"`). */
export function normalizeSourceHandle(sourceHandle: string | null | undefined): string {
  return String(sourceHandle ?? "").trim();
}

export function isErrorOutputEdge(edge: { sourceHandle?: string | null }): boolean {
  return normalizeSourceHandle(edge.sourceHandle) === "error";
}

type MinimalEdge = { source: string; target: string; sourceHandle?: string | null };

/**
 * Graph warnings for ambiguous parallel branches from the same parent (editor).
 */
export function collectBranchWarnings(steps: WorkflowDetail["steps"], edges: MinimalEdge[]): string[] {
  const warnings: string[] = [];
  const byTarget = new Map<string, MinimalEdge[]>();
  for (const e of edges) {
    const list = byTarget.get(e.target) ?? [];
    list.push(e);
    byTarget.set(e.target, list);
  }

  for (const [target, list] of byTarget) {
    const errorIncoming = list.filter(isErrorOutputEdge).length;
    if (errorIncoming > 1) {
      warnings.push(
        `Step "${target}" has ${errorIncoming} incoming error edges; only one error branch into this step is supported.`
      );
    }

    const bySource = new Map<string, MinimalEdge[]>();
    for (const e of list) {
      const arr = bySource.get(e.source) ?? [];
      arr.push(e);
      bySource.set(e.source, arr);
    }
    for (const [src, arr] of bySource) {
      if (arr.length < 2) continue;
      const errCount = arr.filter(isErrorOutputEdge).length;
      if (errCount === 0 || errCount === arr.length) {
        warnings.push(
          `Step "${target}" has ${arr.length} edges from "${src}" with the same outcome type; use one success and one error port from the parent.`
        );
      }
    }
  }

  for (const step of steps) {
    const deps = step.dependsOn ?? [];
    if (step.errorFrom && !deps.includes(step.errorFrom)) {
      warnings.push(
        `Step "${step.id}": errorFrom "${step.errorFrom}" must be listed in dependsOn (same as the error connection source).`
      );
    }
  }

  return warnings;
}

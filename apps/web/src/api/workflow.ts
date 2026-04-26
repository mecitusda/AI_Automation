import { apiFetch } from "./client";

export type WorkflowSummary = {
  id: string;
  name: string;
  enabled: boolean;
  currentVersion: number;
  stepCount: number;
  trigger: WorkflowTrigger | "manual" | "cron";
};

type WorkflowSummaryApiRow = {
  id?: string;
  _id?: string;
  name?: string;
  enabled?: boolean;
  currentVersion?: number;
  stepCount?: number;
  trigger?: WorkflowSummary["trigger"];
};

export type WorkflowVersionInfo = {
  version: number;
  stepCount: number;
  maxParallel: number;
  createdAt: string;
};

export type WorkflowVersionsResponse = {
  workflowId: string;
  currentVersion: number;
  versions: WorkflowVersionInfo[];
};

export type RollbackResponse = {
  ok: boolean;
  workflowId: string;
  currentVersion: number;
};

export type WorkflowTrigger = {
  type: "manual" | "cron" | "trigger.webhook";
  cron?: string;
  schedule?: string;
  timezone?: string;
  webhookSecret?: string;
};

export type WorkflowDetail = {
  id: string;
  name: string;
  enabled: boolean;
  currentVersion: number;
  maxParallel: number;
  trigger: WorkflowTrigger;
  steps: {
    id: string;
    type: string;
    dependsOn?: string[];
    dependencyModes?: Record<string, "iteration" | "barrier">;
    branch?: string;
    errorFrom?: string;
    retry?: number;
    timeout?: number;
    params?: Record<string, any>;
    disabled?: boolean;
  }[];
};

export async function rollbackWorkflow(
  id: string,
  version: number
) : Promise<RollbackResponse>{
  return apiFetch<RollbackResponse>(
    `/workflows/${id}/rollback/${version}`,
    { method: "POST" }
  );
}

export async function fetchWorkflowVersions(id: string): Promise<WorkflowVersionsResponse> {
  return apiFetch<WorkflowVersionsResponse>(`/workflows/${id}/versions`);
}

export type VersionDiffResponse = {
  fromVersion: number;
  toVersion: number;
  added: string[];
  removed: string[];
  changed: { stepId: string; changes: { field: string; old: unknown; new: unknown }[] }[];
};

export async function fetchVersionDiff(
  workflowId: string,
  fromVersion: number,
  toVersion: number
): Promise<VersionDiffResponse> {
  return apiFetch<VersionDiffResponse>(
    `/workflows/${workflowId}/versions/diff?from=${fromVersion}&to=${toVersion}`
  );
}

export async function startRun(
  workflowId: string,
  options?: { workflowVersion?: number; triggerPayload?: Record<string, unknown> }
): Promise<{ message: string; runId: string }> {
  return apiFetch<{ message: string; runId: string }>(`/workflows/${workflowId}/run`, {
    method: "POST",
    body: JSON.stringify(options ?? {}),
  });
}

export function fetchWorkflows(): Promise<WorkflowSummary[]> {
  return apiFetch<unknown>("/workflows").then((raw) => {
    if (!Array.isArray(raw)) {
      throw new Error("Invalid /workflows response: expected an array");
    }
    
    return raw.map((item) => {
      if (!item || typeof item !== "object") {
        throw new Error("Invalid /workflows response: item is not an object");
      }
      const row = item as WorkflowSummaryApiRow;
      const id = String(row.id ?? row._id ?? "").trim();
      if (!id) {
        throw new Error("Invalid /workflows response: missing workflow id");
      }
      return {
        id,
        name: String(row.name ?? "Untitled"),
        enabled: Boolean(row.enabled),
        currentVersion: Number(row.currentVersion ?? 1),
        stepCount: Number(row.stepCount ?? 0),
        trigger: row.trigger ?? "manual",
      } satisfies WorkflowSummary;
    });
  });
}

export type CreateWorkflowBody = {
  name: string;
  steps?: WorkflowDetail["steps"];
  maxParallel?: number;
  trigger?: WorkflowTrigger;
  enabled?: boolean;
};

export async function createWorkflow(body: CreateWorkflowBody): Promise<WorkflowDetail> {
  const result = await apiFetch<{ _id?: string; id?: string; name: string; steps: WorkflowDetail["steps"]; maxParallel: number; trigger: { type: string }; enabled: boolean; currentVersion: number }>("/workflows", {
    method: "POST",
    body: JSON.stringify({
      name: body.name,
      steps: body.steps ?? [],
      maxParallel: body.maxParallel ?? 5,
      trigger: body.trigger ?? { type: "manual" },
      enabled: body.enabled ?? true,
    }),
  });
  const id = result.id ?? (result as { _id?: string })._id?.toString();
  if (!id) throw new Error("Create workflow did not return an id");
  return fetchWorkflowDetail(id);
}

export async function fetchWorkflowDetail(id: string): Promise<WorkflowDetail> {
  return apiFetch(`/workflows/${id}`);
}

export async function updateWorkflow(
  id: string,
  body: { name?: string; steps?: WorkflowDetail["steps"]; maxParallel?: number; trigger?: WorkflowTrigger; enabled?: boolean }
): Promise<WorkflowDetail> {
  return apiFetch(`/workflows/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** Fetch step output from latest run for a workflow (for output structure preview in editor). */
export async function fetchStepOutputPreview(
  workflowId: string,
  stepId: string
): Promise<unknown> {
  return apiFetch<unknown>(`/workflows/${workflowId}/steps/${stepId}/output-preview`);
}
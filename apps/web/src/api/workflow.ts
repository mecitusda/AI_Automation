import { apiFetch } from "./client";

export type WorkflowSummary = {
  id: string;
  name: string;
  enabled: boolean;
  currentVersion: number;
  stepCount: number;
  trigger: "manual" | "cron";
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

export type WorkflowDetail = {
  id: string;
  name: string;
  enabled: boolean;
  currentVersion: number;
  maxParallel: number;
  trigger: "manual" | "cron";
  steps: {
    id: string;
    type: string;
    dependsOn?: string[];
    retry?: number;
    timeout?: number;
    params?: Record<string, any>;
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

export function fetchWorkflows(): Promise<WorkflowSummary[]> {
  return apiFetch<WorkflowSummary[]>("/workflows");
}

export async function fetchWorkflowDetail(id: string): Promise<WorkflowDetail> {
  return apiFetch(`/workflows/${id}`);
}
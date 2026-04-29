import { apiFetch } from "./client";

export type ReplayResponse = { runId: string; message: string };

export function replayRun(runId: string, fromStepId: string): Promise<ReplayResponse> {
  return apiFetch<ReplayResponse>(`/runs/${runId}/replay`, {
    method: "POST",
    body: JSON.stringify({ fromStepId }),
  });
}

export type RunDetailStep = {
  id: string;
  type: string;
  retry?: number;
  retryDelay?: number;
  timeout?: number;
  dependsOn?: string[];
  dependencyModes?: Record<string, "iteration" | "barrier">;
  branch?: string;
  errorFrom?: string;
  disabled?: boolean;
  params?: Record<string, unknown>;
};

export type RunDetailStepState = {
  stepId: string;
  iteration: number;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  retryCount?: number;
  executionId?: string;
};

export type RunDetailLog = {
  stepId: string;
  message: string;
  level: string;
  status?: string;
  durationMs?: number;
  attempt?: number;
  error?: string;
  createdAt?: string;
};

export type RunDetailStepInput = {
  executionId?: string;
  params?: Record<string, unknown>;
  startedAt?: string;
};

export type RunDetail = {
  id: string;
  workflowId?: string;
  status: string;
  topologySource?: string;
  createdAt: string;
  finishedAt?: string;
  durationMs?: number;
  workflowVersion: number;
  steps: RunDetailStep[];
  stepStates: RunDetailStepState[];
  outputs: Record<string, unknown>;
  logs?: RunDetailLog[];
  loopContext?: unknown;
  lastError?: { stepId?: string; message?: string; iteration?: number; attempt?: number } | null;
  /** Key: `${stepId}::${iteration}` */
  stepInputs?: Record<string, RunDetailStepInput>;
};

export async function fetchRunDetail(id: string, init?: RequestInit): Promise<RunDetail> {
  return apiFetch<RunDetail>(`/runs/${id}/detail`, init);
}

export type RunSummary = {
  id: string;
  workflowId?: string;
  workflowName?: string;
  status: string;
  createdAt?: string;
};

export async function fetchRuns(): Promise<RunSummary[]> {
  const list = await apiFetch<Array<{ _id: string; workflowId?: string | { _id?: string; name?: string }; status: string; createdAt?: string }>>("/runs");
  return list.map((r) => ({
    id: r._id,
    workflowId: typeof r.workflowId === "object" && r.workflowId && "_id" in r.workflowId
      ? (r.workflowId as { _id: string })._id
      : typeof r.workflowId === "string"
        ? r.workflowId
        : undefined,
    workflowName: typeof r.workflowId === "object" && r.workflowId && "name" in r.workflowId
      ? (r.workflowId as { name?: string }).name
      : undefined,
    status: r.status,
    createdAt: r.createdAt,
  }));
}


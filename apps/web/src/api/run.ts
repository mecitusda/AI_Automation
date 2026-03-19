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
  timeout?: number;
  dependsOn?: string[];
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

export type RunDetail = {
  id: string;
  workflowId?: string;
  status: string;
  createdAt: string;
  finishedAt?: string;
  durationMs?: number;
  workflowVersion: number;
  steps: RunDetailStep[];
  stepStates: RunDetailStepState[];
  outputs: Record<string, unknown>;
  logs?: RunDetailLog[];
  loopContext?: unknown;
};

export async function fetchRunDetail(id: string): Promise<RunDetail> {
  return apiFetch<RunDetail>(`/runs/${id}/detail`);
}

export type RunSummary = {
  id: string;
  workflowId?: string;
  status: string;
  createdAt?: string;
};

export async function fetchRuns(): Promise<RunSummary[]> {
  const list = await apiFetch<Array<{ _id: string; workflowId?: string | { _id?: string }; status: string; createdAt?: string }>>("/runs");
  return list.map((r) => ({
    id: r._id,
    workflowId: typeof r.workflowId === "object" && r.workflowId && "_id" in r.workflowId
      ? (r.workflowId as { _id: string })._id
      : typeof r.workflowId === "string"
        ? r.workflowId
        : undefined,
    status: r.status,
    createdAt: r.createdAt,
  }));
}


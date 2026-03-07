import { apiFetch } from "./client";

export type MonitoringSummary = {
  globalMax: number;
  globalInflight: number;
  globalTokensCount: number;
  readyQueueLen: number;
  sanity: {
    inflightEqualsTokens: boolean;
    inflightOverMax: boolean;
  };
  stuckRuns: number;
  ts: number;
};

export type StuckRun = {
  id: string;
  createdAt: string;
  ageMs: number;
  stepCount: number;
};

export async function fetchStuckRuns() {
  return apiFetch<{ ok: boolean; count: number; data: StuckRun[] }>(
    "/monitoring/stuck"
  );
}

export async function healRun(runId: string) {
  return apiFetch(`/monitoring/stuck/${runId}/heal`);
}

export async function fetchMonitoring(): Promise<MonitoringSummary> {
  return apiFetch<MonitoringSummary>("/monitoring/summary");
}
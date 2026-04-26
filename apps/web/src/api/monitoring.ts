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

export type MonitoringPerfRoute = {
  route: string;
  count: number;
  errorCount: number;
  avgMs: number;
  p95Ms: number | null;
  maxMs: number;
  lastStatus: number | null;
  lastTs: number | null;
};

export type MonitoringPerfResponse = {
  ok: boolean;
  ts: number;
  slowThresholdMs: number;
  routeCount: number;
  routes: MonitoringPerfRoute[];
};

export async function fetchMonitoringPerf(): Promise<MonitoringPerfResponse> {
  return apiFetch<MonitoringPerfResponse>("/monitoring/perf");
}
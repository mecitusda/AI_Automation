import { apiFetch } from "./client";

export type SummaryMetrics = {
  ok: boolean;
  ts: number;
  windowSec: number;
  runsByStatus: Record<string, number>;
  logs: {
    errorCount: number;
    retryLogCount: number;
    timeoutHintCount: number;
  };
};

export function fetchSummary(windowSec = 3600) {
  return apiFetch<SummaryMetrics>(
    `/metrics/summary?windowSec=${windowSec}`
  );
}

export type DashboardMetrics = {
  ok: boolean;
  ts: number;
  windowSec: number;
  avgRunDurationMs: number | null;
  stepFailureRate: number | null;
  activeRuns: number;
  runsPerWorkflow: { workflowId: string; count: number }[];
  stepExecutionCount: number;
};

export function fetchDashboard(windowSec = 3600) {
  return apiFetch<DashboardMetrics>(
    `/metrics/dashboard?windowSec=${windowSec}`
  );
}
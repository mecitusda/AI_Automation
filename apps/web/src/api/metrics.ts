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
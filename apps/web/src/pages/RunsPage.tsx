import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { socket } from "../api/socket";
import { apiFetch, getCurrentUserRole } from "../api/client";
import "../styles/runs.css";
import MonitoringCard from "../components/MonitoringCard";
import { useSummary } from "../hooks/useSummary";
import { Button, PageState } from "../components/ui";
import { useI18n } from "../hooks/useI18n";

type StepState = {
  stepId: string;
  retryCount: number;
  status: "pending" | "running" | "retrying" | "completed" | "failed" | "skipped" | "cancelled";
  durationMs?: number;
  iteration?: number;
};

type WorkflowRef = string | { _id?: string; name?: string };

type Run = {
  _id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  currentStepIndex: number;
  finishedAt?: string;
  durationMs?: number;
  stepStates: StepState[];
  createdAt: string;
  workflowId?: WorkflowRef;
};

type RunsPageResponse = {
  items: Run[];
  nextCursor?: string | null;
  hasMore?: boolean;
};

type RunUpdatePayload = {
  id: string; // backend emitRunUpdate: id
  status: Run["status"];
  currentStepIndex: number;
  finishedAt?: string;
  durationMs?: number;
  stepStates?: StepState[];
};

const STEP_PREVIEW_LIMIT = 8;

function summarizeStepStates(stepStates: StepState[] = []) {
  const counts = stepStates.reduce<Record<StepState["status"], number>>(
    (acc, step) => {
      acc[step.status] = (acc[step.status] ?? 0) + 1;
      return acc;
    },
    {
      pending: 0,
      running: 0,
      retrying: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
    }
  );
  const uniqueStepCount = new Set(stepStates.map((step) => step.stepId)).size;
  const priority = { failed: 0, retrying: 1, running: 2, cancelled: 3, pending: 4, skipped: 5, completed: 6 };
  const preview = [...stepStates]
    .sort((a, b) => (priority[a.status] ?? 99) - (priority[b.status] ?? 99))
    .slice(0, STEP_PREVIEW_LIMIT);
  return {
    counts,
    uniqueStepCount,
    total: stepStates.length,
    preview,
    remaining: Math.max(0, stepStates.length - STEP_PREVIEW_LIMIT),
  };
}

export default function RunsPage() {
  const { t } = useI18n();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const isAdmin = getCurrentUserRole() === "admin";
  const summary = useSummary(3600, isAdmin);

  const loadRuns = (cursor?: string | null) => {
    const params = new URLSearchParams({ format: "page", limit: "50" });
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (cursor) params.set("cursor", cursor);
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setLoadError("");
    apiFetch<RunsPageResponse>(`/runs?${params.toString()}`)
      .then((data) => {
        setRuns((prev) => cursor ? [...prev, ...(data.items ?? [])] : (data.items ?? []));
        setNextCursor(data.nextCursor ?? null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : t("runs.couldNotLoad")))
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });
  };

  useEffect(() => {
    loadRuns();
  }, [statusFilter]);
  
  useEffect(() => {
    const handleRunUpdate = (update: RunUpdatePayload) => {
      setRuns((prev) => {
        const index = prev.findIndex((r) => r._id === update.id);

        if (index !== -1) {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            status: update.status,
            currentStepIndex: update.currentStepIndex,
            finishedAt: update.finishedAt,
            durationMs: update.durationMs,
            stepStates: update.stepStates ?? updated[index].stepStates,
          };
          return updated;
        }

        const newRun: Run = {
          _id: update.id,
          status: update.status,
          currentStepIndex: update.currentStepIndex,
          finishedAt: update.finishedAt,
          durationMs: update.durationMs,
          stepStates: update.stepStates ?? [],
          createdAt: new Date().toISOString(),
        };

        return [newRun, ...prev];
      });
    };

    socket.on("runs:update", handleRunUpdate);

    return () => {
      socket.off("runs:update", handleRunUpdate);
    };
  }, []);

  const progressPercent = (run: Run) => {
    // Run finished (completed/failed/cancelled) → 100% (task completion, like n8n)
    if (["completed", "failed", "cancelled"].includes(run.status)) return 100;
    if (!run.stepStates?.length) return 0;
    const completed = run.stepStates.filter((s) => s.status === "completed").length;
    return Math.round((completed / run.stepStates.length) * 100);
  };

  const workflowLabel = (run: Run) => {
    if (typeof run.workflowId === "object" && run.workflowId?.name) return run.workflowId.name;
    if (typeof run.workflowId === "string") return `Workflow ${run.workflowId.slice(-6)}`;
    return "Unknown workflow";
  };

  

  return (
    <div className="pageLayout">
      {loading ? <div className="spinner"></div> :

        <>
      <header className="pageHeader">
        <div>
          <h1 className="title">{t("runs.title")}</h1>
          <p className="subtle">{t("runs.subtitle")}</p>
        </div>
        <div className="uiToolbar" style={{ marginBottom: 0 }}>
          <select className="uiInput" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">{t("runs.allStatuses")}</option>
            <option value="queued">{t("runs.queued")}</option>
            <option value="running">{t("runs.running")}</option>
            <option value="completed">{t("runs.completed")}</option>
            <option value="failed">{t("runs.failed")}</option>
            <option value="cancelled">{t("runs.cancelled")}</option>
          </select>
          <div className="meta">{t("runs.loaded")}: {runs.length}</div>
        </div>
      </header>
      <main className="pageContent">
      {loadError ? (
        <PageState title={t("runs.couldNotLoad")} message={loadError} action={<Button onClick={() => loadRuns()}>{t("common.retry")}</Button>} />
      ) : null}
      {isAdmin && (
        <>
          <div className="pageSection">
            <div className="metricsTitle">{t("runs.systemHealth")}</div>
            <div className="metricsGrid">
              <div className="metric">
                <div className="metricLabel">Runs (1h)</div>
                <div className="metricValue">
                  {summary
                    ? Object.values(summary.runsByStatus || {}).reduce((a, b) => a + b, 0)
                    : "—"}
                </div>
                <div className="metricHint">
                  ✅ {summary?.runsByStatus?.completed ?? 0} ·
                  ❌ {summary?.runsByStatus?.failed ?? 0} ·
                  ⏳ {summary?.runsByStatus?.running ?? 0}
                </div>
              </div>

              <div className="metric">
                <div className="metricLabel">
                  {t("runs.errorsRetryTimeout")}
                </div>
                <div className="metricValue">
                  {summary
                    ? `${summary.logs.errorCount} / ${summary.logs.retryLogCount} / ${summary.logs.timeoutHintCount}`
                    : "—"}
                </div>
                <div className="metricHint">{t("runs.logBasedCounters")}</div>
              </div>
            </div>
          </div>
          <div className="pageSection">
            <MonitoringCard enabled={isAdmin} />
          </div>
        </>
      )}
      {!loadError && runs.length === 0 ? (
        <PageState title={t("runs.noRuns")} message={t("runs.noRunsMessage")} />
      ) : null}
      <div className="grid">
        {runs.map((run) => {
          const pct = progressPercent(run);
          const stepSummary = summarizeStepStates(run.stepStates ?? []);

          return (
            <Link key={run._id} to={`/runs/${run._id}`} className="cardLink">
              <div className="card card--run">
                <div className="row">
                  <div>
                    <div className="workflowName">{workflowLabel(run)}</div>
                    <div className="id">#{run._id}</div>
                    <div className="created">{new Date(run.createdAt).toLocaleString()}</div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <span className={`badge ${run.status}`}>{run.status}</span>
                    <div className="duration">{run.durationMs ?? 0} ms</div>
                  </div>
                </div>

                <div className="progressWrap">
                  <div className="progressBar">
                    <div className="progressFill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="progressText">{t("runs.progress")}: {pct}%</div>
                </div>

                <div className="runStepSummary">
                  <div className="runStepSummary__stats">
                    <span>{stepSummary.uniqueStepCount} {t("runs.steps")}</span>
                    <span>{stepSummary.total} {t("runs.executions")}</span>
                    {stepSummary.counts.running > 0 ? <span>{stepSummary.counts.running} {t("runs.running").toLowerCase()}</span> : null}
                    {stepSummary.counts.failed > 0 ? <span className="is-danger">{stepSummary.counts.failed} {t("runs.failed").toLowerCase()}</span> : null}
                    {stepSummary.counts.retrying > 0 ? <span>{stepSummary.counts.retrying} retrying</span> : null}
                    {stepSummary.counts.skipped > 0 ? <span>{stepSummary.counts.skipped} {t("runs.skipped")}</span> : null}
                  </div>
                  {stepSummary.preview.length > 0 ? (
                    <div className="badgesRow badgesRow--preview">
                      {stepSummary.preview.map((step, idx) => (
                        <span key={`${step.stepId}:${step.iteration ?? "na"}:${idx}`} className={`stepBadge ${step.status}`}>
                          {step.stepId}
                          {step.iteration != null && step.iteration > 0 ? <span className="retryChip">#{step.iteration}</span> : null}
                          {step.retryCount > 0 && <span className="retryChip">R{step.retryCount}</span>}
                        </span>
                      ))}
                      {stepSummary.remaining > 0 ? (
                        <span className="stepBadge stepBadge--more">+{stepSummary.remaining} {t("runs.more")}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      {nextCursor ? (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
          <Button onClick={() => loadRuns(nextCursor)} disabled={loadingMore}>
            {loadingMore ? t("common.loading") : t("common.loadMore")}
          </Button>
        </div>
      ) : null}
      </main>
      </>
      }
    </div>
  );
}
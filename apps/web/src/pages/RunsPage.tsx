import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { socket } from "../api/socket";
import { apiFetch, getCurrentUserRole } from "../api/client";
import "../styles/runs.css";
import MonitoringCard from "../components/MonitoringCard";
import { useSummary } from "../hooks/useSummary";

type StepState = {
  stepId: string;
  retryCount: number;
  status: "pending" | "running" | "retrying" | "completed" | "failed";
  durationMs?: number;
  iteration?: number;
};

type Run = {
  _id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  currentStepIndex: number;
  finishedAt?: string;
  durationMs?: number;
  stepStates: StepState[];
  createdAt: string;
};

type RunUpdatePayload = {
  id: string; // backend emitRunUpdate: id
  status: Run["status"];
  currentStepIndex: number;
  finishedAt?: string;
  durationMs?: number;
  stepStates?: StepState[];
};

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = getCurrentUserRole() === "admin";
  const summary = useSummary(3600, isAdmin);
  useEffect(() => {
    apiFetch<Run[]>("/runs")
      .then((data) => {
        setRuns(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);
  
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

  

  return (
    <div className="pageLayout">
      {loading ? <div className="spinner"></div> :

        <>
      <header className="pageHeader">
        <h1 className="title">Workflow Runs</h1>
        <div className="meta">Total: {runs.length}</div>
      </header>
      <main className="pageContent">
      {isAdmin && (
        <>
          <div className="pageSection">
            <div className="metricsTitle">System Health</div>
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
                  Errors / Retry / Timeout (last 1 hour)
                </div>
                <div className="metricValue">
                  {summary
                    ? `${summary.logs.errorCount} / ${summary.logs.retryLogCount} / ${summary.logs.timeoutHintCount}`
                    : "—"}
                </div>
                <div className="metricHint">log-based counters</div>
              </div>
            </div>
          </div>
          <div className="pageSection">
            <MonitoringCard enabled={isAdmin} />
          </div>
        </>
      )}
      <div className="grid">
        {runs.map((run) => {
          const pct = progressPercent(run);

          return (
            <Link key={run._id} to={`/runs/${run._id}`} className="cardLink">
              <div className="card card--run">
                <div className="row">
                  <div>
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
                  <div className="progressText">Progress: {pct}%</div>
                </div>

                <div className="badgesRow">
                  {run.stepStates?.map((step, idx) => (
                    <span key={`${step.stepId}:${step.iteration ?? "na"}:${idx}`} className={`stepBadge ${step.status}`}>
                      {step.stepId}
                      {step.retryCount > 0 && <span className="retryChip">R{step.retryCount}</span>}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      </main>
      </>
      }
    </div>
  );
}
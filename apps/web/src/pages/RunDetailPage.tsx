import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { socket } from "../api/socket";
import { replayRun, fetchRunDetail, type RunDetail } from "../api/run";
import { apiFetch } from "../api/client";
import RunStepInspectorModal from "../components/RunStepInspectorModal";
import "../styles/runs.css";
import type { WorkflowDetail } from "../api/workflow";
import WorkflowGraph from "../components/WorkflowGraph";
import { fetchWorkflowDetail } from "../api/workflow";
import { shouldShowSeparateLogError } from "../utils/runLogDisplay";

const STATUS_LEGEND = [
  { status: "running",   color: "#3b82f6", label: "Running"   },
  { status: "completed", color: "#22c55e", label: "Completed" },
  { status: "failed",    color: "#ef4444", label: "Failed"   },
  { status: "retrying",  color: "#fb923c", label: "Retrying" },
  { status: "pending",   color: "#94a3b8", label: "Pending"  },
  { status: "skipped",   color: "#a855f7", label: "Skipped"   },
  { status: "partial",   color: "#14b8a6", label: "Partial (some iterations skipped)" },
  { status: "cancelled", color: "#78716c", label: "Cancelled" },
];

type StepState = {
  stepId: string;
  retryCount: number;
  status: "pending" | "running" | "retrying" | "completed" | "failed" | "skipped" | "cancelled";
  durationMs?: number;
  iteration?: number;
};

type Log = {
  stepId?: string;
  message: string;
  level: "info" | "warning" | "error" | "retry" | "system";
  createdAt?: string;
  error?: string;
  attempt?: number;
  status?: string;
};

type Run = {
  _id: string;
  status: string;
  durationMs?: number;
  workflow?: {
    _id: string;
    name: string;
  };
  stepStates: StepState[];
  logs: Log[];
  loopState?: Record<string, { index?: number; items?: unknown[] }>;
  lastError?: { stepId?: string; message?: string; iteration?: number; attempt?: number };
};

type RunUpdatePayload = {
  id: string;
  status: string;
  durationMs?: number;
  currentStepIndex?: number;
  finishedAt?: string;
  stepStates?: StepState[];
  loopState?: Record<string, { index?: number; items?: unknown[] }>;
};

const STEP_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#eab308",
  "#ef4444",
  "#a855f7",
  "#06b6d4",
  "#f97316",
  "#ec4899",
];

function getStepColor(stepId: string | undefined | null) {
  const id = stepId ?? "";
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % STEP_COLORS.length;
  return STEP_COLORS[index];
}

export default function RunDetailPage() {
  const { id: runId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [run, setRun] = useState<Run | null>(null);
  const [stepStates, setStepStates] = useState<StepState[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayFromStepId, setReplayFromStepId] = useState<string>("");
  const [logLevelFilter, setLogLevelFilter] = useState<"all" | Log["level"]>("all");
  const [logSearch, setLogSearch] = useState("");
  const [stepStatusFilter, setStepStatusFilter] = useState<"all" | StepState["status"]>("all");
  const [inspectorStepId, setInspectorStepId] = useState<string | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);
  const detailRefreshTimerRef = useRef<number | null>(null);

  // initial fetch
  useEffect(() => {
    if (!runId) return;

    apiFetch<Run>(`/runs/${runId}`)
      .then((data: Run) => {
        setRun(data);
        setStepStates(data.stepStates ?? []);
        setLogs(data.logs ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [runId]);

  // fetch detailed run snapshot for debugger/output inspection
  useEffect(() => {
    if (!runId) return;
    fetchRunDetail(runId)
      .then((d) => setRunDetail(d))
      .catch(() => {
        // non-fatal; debugger panel will simply not render
        setRunDetail(null);
      });
  }, [runId]);

  const scheduleRunDetailRefresh = (delayMs = 600) => {
    if (!runId) return;
    if (detailRefreshTimerRef.current != null) {
      window.clearTimeout(detailRefreshTimerRef.current);
    }
    detailRefreshTimerRef.current = window.setTimeout(() => {
      fetchRunDetail(runId)
        .then((d) => setRunDetail(d))
        .catch(() => {});
      detailRefreshTimerRef.current = null;
    }, delayMs);
  };
  
  // socket listeners
  useEffect(() => {
    if (!runId) return;

    socket.emit("run:join", { runId });

    const handleUpdate = (summary: RunUpdatePayload) => {
      if (!summary?.id || summary.id !== runId) return;
      setRun((prev) =>
        prev
          ? {
              ...prev,
              status: summary.status ?? prev.status,
              durationMs: summary.durationMs ?? prev.durationMs,
              loopState: summary.loopState ?? prev.loopState,
            }
          : prev
      );

      if (summary.stepStates) {
        setStepStates(summary.stepStates);
      }
      scheduleRunDetailRefresh(summary.status === "running" ? 600 : 0);
    };

    const handleLog = (log: Log) => {
      setLogs((prev) => [...prev, log]);
      scheduleRunDetailRefresh(1000);
    };

    const handleStepUpdate = (payload: { runId: string; stepId: string; iteration: number; status: string }) => {
      if (payload.runId !== runId) return;
      setStepStates((prev) => {
        const idx = prev.findIndex(
          (s) => s.stepId === payload.stepId && (s.iteration ?? 0) === payload.iteration
        );
        if (idx < 0) {
          return [
            ...prev,
            {
              stepId: payload.stepId,
              iteration: payload.iteration,
              retryCount: 0,
              status: payload.status as StepState["status"],
            }
          ];
        }
        const next = [...prev];
        next[idx] = { ...next[idx], status: payload.status as StepState["status"] };
        return next;
      });
      scheduleRunDetailRefresh(800);
    };

    socket.on("run:update", handleUpdate);
    socket.on("run:log", handleLog);
    socket.on("step:update", handleStepUpdate);

    return () => {
      socket.emit("run:leave", { runId });
      socket.off("run:update", handleUpdate);
      socket.off("run:log", handleLog);
      socket.off("step:update", handleStepUpdate);
      if (detailRefreshTimerRef.current != null) {
        window.clearTimeout(detailRefreshTimerRef.current);
        detailRefreshTimerRef.current = null;
      }
    };
  }, [runId]);

  // autoscroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // fetch workflow
  useEffect(() => {
    if (!run?.workflow?._id) return;

    fetchWorkflowDetail(run.workflow._id).then(setWorkflow);
  }, [run?.workflow?._id]);

  const failureHintByStepId = useMemo(() => {
    const fails = logs.filter((l) => l.level === "error" || l.status === "fail" || l.status === "timeout");
    const rec: Record<string, string> = {};
    for (const log of [...fails].reverse()) {
      if (!log.stepId || rec[log.stepId]) continue;
      const raw = (log.error && log.error.trim()) || log.message || "";
      rec[log.stepId] = raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
    }
    return rec;
  }, [logs]);

  const logKind = (level: Log["level"]) => {
    switch (level) {
      case "error":
        return "error";
      case "retry":
        return "retry";
      case "system":
        return "info";
      default:
        return "info";
    }
  };

  const cancelRun = async () => {
  if (!runId) return;

  const ok = confirm("Cancel this run?");
  if (!ok) return;

  try {
    setCancelling(true);

    await apiFetch(`/runs/${runId}/cancel`, {
      method: "POST"
    });

  } catch (err) {
    console.error("Cancel failed", err);
  } finally {
    setCancelling(false);
  }
};

  const canReplay = run && ["completed", "failed", "cancelled"].includes(run.status);
  const replaySteps = workflow?.steps?.map((s) => s.id) ?? [...new Set((stepStates || []).map((s) => s.stepId))];

  const handleReplay = async () => {
    if (!runId || !replayFromStepId) return;
    setReplayLoading(true);
    try {
      const result = await replayRun(runId, replayFromStepId);
      navigate(`/runs/${result.runId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Replay failed");
    } finally {
      setReplayLoading(false);
    }
  };
  if (loading) return <div className="pageLayout">Loading...</div>;
  if (!run) return <div className="pageLayout">Run not found</div>;
  const filteredStepStates = stepStates.filter((s) => stepStatusFilter === "all" ? true : s.status === stepStatusFilter);
  const filteredLogs = logs.filter((l) => {
    const levelOk = logLevelFilter === "all" ? true : l.level === logLevelFilter;
    const text = `${l.stepId} ${l.message}`.toLowerCase();
    const searchOk = logSearch.trim() ? text.includes(logSearch.toLowerCase()) : true;
    return levelOk && searchOk;
  });
  const failureLogs = logs.filter((l) => l.level === "error" || l.status === "fail" || l.status === "timeout");
  const latestFailureLog = [...failureLogs].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  })[0];
  const failureByStep = new Map<string, Log>();
  for (const log of [...failureLogs].reverse()) {
    const sid = log.stepId;
    if (!sid) continue;
    if (!failureByStep.has(sid)) failureByStep.set(sid, log);
  }
  const loopProgressByStep = Object.fromEntries(
    Object.entries(run.loopState || {}).map(([stepId, state]) => {
      const total = Array.isArray(state?.items) ? state.items.length : 0;
      const index = Number(state?.index ?? 0);
      const current = total > 0 ? Math.min(index + 1, total) : 0;
      return [stepId, { current, total }];
    })
  );

  return (
    <div className="pageLayout">
      <header className="pageHeader">
        <div>
          <div className="title">Run: <span className="text-orange">{run.workflow?.name ?? "Unknown Workflow"}</span> #{run._id}</div>
          <div className="meta">Status: <strong className={`${run.status}`}>{run.status}</strong>  </div>
          <div className="meta">Duration: {run.durationMs ?? 0} ms</div>
          {(run.status === "failed" || run.status === "cancelled") && (latestFailureLog || run.lastError?.message) && (
            <div className="meta" style={{ marginTop: 6, color: "#f87171" }}>
              Reason:{" "}
              {(run.lastError?.message && run.lastError.message.trim()) ||
                latestFailureLog?.error ||
                latestFailureLog?.message ||
                ""}
            </div>
          )}
        </div>
        {(run.status === "running" || run.status === "retrying") && (
    <button
      className="cancelBtn"
      onClick={cancelRun}
      disabled={cancelling}
    >
      {cancelling ? "Cancelling..." : "Cancel Run"}
    </button>
  )}
        {canReplay && replaySteps.length > 0 && (
          <div className="runDetailReplay">
            <span className="runDetailReplay__label">Replay from</span>
            <select
              className="runDetailReplay__select"
              value={replayFromStepId}
              onChange={(e) => setReplayFromStepId(e.target.value)}
              aria-label="Choose step to replay from"
            >
              <option value="">Select step…</option>
              {replaySteps.map((stepId) => (
                <option key={stepId} value={stepId}>{stepId}</option>
              ))}
            </select>
            <button
              type="button"
              className="runDetailReplay__btn"
              onClick={handleReplay}
              disabled={replayLoading || !replayFromStepId}
            >
              {replayLoading ? "Starting…" : "Start replay"}
            </button>
          </div>
        )}
      </header>

      <main className="pageContent">
      <div className="pageSection" style={{ marginBottom: 16 }}>
        <div className="sectionTitle">Steps</div>
        <div style={{ marginBottom: 8 }}>
          <label style={{ marginRight: 8 }}>Status filter:</label>
          <select value={stepStatusFilter} onChange={(e) => setStepStatusFilter(e.target.value as any)}>
            <option value="all">all</option>
            <option value="pending">pending</option>
            <option value="running">running</option>
            <option value="retrying">retrying</option>
            <option value="completed">completed</option>
            <option value="failed">failed</option>
            <option value="skipped">skipped</option>
            <option value="cancelled">cancelled</option>
          </select>
        </div>
        <div className="row">
        {filteredStepStates.map((step) => (
          <div
            key={`${step.stepId}-${step.iteration ?? 0}`}
            className="stepRow stepRow--clickable"
            role="button"
            tabIndex={0}
            onClick={() => setInspectorStepId(step.stepId)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setInspectorStepId(step.stepId);
              }
            }}
          >
            <div>
              <div className="stepName">
                {step.stepId}
                {step.iteration !== undefined && step.iteration !== 0 && (
                  <span style={{ marginLeft: 6, opacity: 0.8 }}>[{step.iteration}]</span>
                )}
              </div>
              <div className="stepMeta">
                {step.durationMs !== undefined && <span>{step.durationMs} ms</span>}
                {step.retryCount > 0 && <span>Retry: {step.retryCount}</span>}
                {step.status === "failed" && failureByStep.get(step.stepId) && (
                  <span style={{ color: "#f87171" }}>
                    {failureByStep.get(step.stepId)?.error || failureByStep.get(step.stepId)?.message}
                  </span>
                )}
              </div>
            </div>

            <span className={`stepStatus ${step.status}`}>
              {step.status}
            </span>
          </div>
        ))}</div>
      </div>

      <div className="pageSection" style={{ marginBottom: 16 }}>
        <div className="sectionTitle">Run Timeline</div>
        <div className="timelinePanel" style={{ padding: "12px 0" }}>
          {filteredLogs
            .filter((log) =>
              log.message?.startsWith("[RUN START]") ||
              log.message?.startsWith("[STEP START]") ||
              log.message?.startsWith("[STEP COMPLETE]") ||
              log.message?.startsWith("[STEP RETRY]") ||
              log.message?.includes("Retry scheduled") ||
              log.message?.startsWith("[RUN COMPLETE]") ||
              log.message?.startsWith("[STEP TIMEOUT]") ||
              log.message?.startsWith("[STEP FAIL]") ||
              (log.stepId === "system" && log.message?.toLowerCase().includes("completed"))
            )
            .map((log, i) => {
              let label = log.message;
              if (log.message?.startsWith("[RUN START]")) label = "Run started";
              else if (log.message?.startsWith("[STEP START]")) label = "Step started";
              else if (log.message?.startsWith("[STEP COMPLETE]")) label = "Step completed";
              else if (log.message?.startsWith("[STEP RETRY]") || log.message?.includes("Retry scheduled")) label = "Retry scheduled";
              else if (log.message?.startsWith("[RUN COMPLETE]") || (log.stepId === "system" && log.message?.toLowerCase().includes("completed"))) label = "Run completed";
              else if (log.message?.startsWith("[STEP TIMEOUT]")) label = log.message;
              else if (log.message?.startsWith("[STEP FAIL]")) label = log.message;
              return (
                <div key={i} className="logRow" style={{ marginBottom: 8 }}>
                  <div className="logTime" style={{ minWidth: 80, fontSize: "1.2rem", fontWeight: "bold" }}>
                    {log.createdAt ? new Date(log.createdAt).toLocaleTimeString() : ""}
                  </div>
                  <div className={`logMsg ${logKind(log.level)}`} style={{ fontSize: "1.2rem", fontWeight: "bold" }}>{label}</div>
                  {log.stepId && log.stepId !== "system" && (
                    <span style={{ marginLeft: 8, opacity: 0.8, color: getStepColor(log.stepId), fontSize: "1.2rem", fontWeight: "bold" }}>[{log.stepId}]</span>
                  )}
                  {shouldShowSeparateLogError(log.message, log.error) ? (
                    <div style={{ marginLeft: 88, fontSize: "0.95rem", color: "#fca5a5", marginTop: 4 }}>{log.error}</div>
                  ) : null}
                </div>
              );
            })}
        </div>
      </div>

      {workflow && (
        <div className="pageSection" style={{ marginBottom: 20 }}>
          <div className="sectionTitle">Execution Graph</div>
          <p className="runExecutionGraph__hint">
            Click any node to open resolved inputs, outputs, and logs for that step.
          </p>
          <div className="graph-color-info">
            {STATUS_LEGEND.map(({ status, color, label }) => (
              <div key={status} className="graph-color-info__item">
                <span
                  className="graph-color-info__dot"
                  style={{
                    background: color,
                    boxShadow: ["running","completed","failed","retrying","partial"].includes(status)
                      ? `0 0 6px ${color}`
                      : "none",
                  }}
                />
                <span className="graph-color-info__label">{label}</span>
              </div>
            ))}
          </div>
          <div className="runExecutionGraph">
            <WorkflowGraph
              steps={workflow.steps}
              stepStates={stepStates}
              loopProgressByStep={loopProgressByStep}
              failureHintByStepId={failureHintByStepId}
              onNodeClick={(step) => setInspectorStepId(step.id)}
            />
          </div>
        </div>
      )}

      <RunStepInspectorModal
        open={inspectorStepId != null}
        onClose={() => setInspectorStepId(null)}
        detail={runDetail}
        stepId={inspectorStepId}
      />

      <div className="pageSection">
        <div className="sectionTitle">Logs</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <select value={logLevelFilter} onChange={(e) => setLogLevelFilter(e.target.value as any)}>
            <option value="all">all levels</option>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="error">error</option>
            <option value="retry">retry</option>
            <option value="system">system</option>
          </select>
          <input
            placeholder="Search logs..."
            value={logSearch}
            onChange={(e) => setLogSearch(e.target.value)}
          />
        </div>

        <div className="logPanel">
          {filteredLogs.map((log, i) => (
            <div key={i} className="logRow">
              <div className="logTime">
                {log.createdAt
                  ? new Date(log.createdAt).toLocaleTimeString()
                  : ""}
              </div>

              <div
                className="logStep"
                style={{ color: getStepColor(log.stepId) }}
              >
                [{log.stepId ?? "system"}]
              </div>

              <div className={`logMsg ${logKind(log.level)}`}>
                {log.message}
                {shouldShowSeparateLogError(log.message, log.error) ? (
                  <div style={{ marginTop: 4, fontSize: "0.9em", opacity: 0.95, color: "#fecaca" }}>{log.error}</div>
                ) : null}
              </div>
            </div>
          ))}

          <div ref={logEndRef} />
        </div>
      </div>
      </main>
    </div>
  );
}
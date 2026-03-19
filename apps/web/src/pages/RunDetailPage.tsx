import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { socket } from "../api/socket";
import { replayRun, fetchRunDetail, type RunDetail } from "../api/run";
import RunDebuggerPanel from "../components/RunDebuggerPanel";
import "../styles/runs.css";
import type { WorkflowDetail } from "../api/workflow";
import WorkflowGraph from "../components/WorkflowGraph";
import { fetchWorkflowDetail } from "../api/workflow";

const STATUS_LEGEND = [
  { status: "running",   color: "#3b82f6", label: "Running"   },
  { status: "completed", color: "#22c55e", label: "Completed" },
  { status: "failed",    color: "#ef4444", label: "Failed"   },
  { status: "retrying",  color: "#f59e0b", label: "Retrying" },
  { status: "pending",   color: "#6b7280", label: "Pending"  },
  { status: "skipped",   color: "#eab308", label: "Skipped"   },
  { status: "partial",   color: "#f59e0b", label: "Partial (some iterations skipped)" },
  { status: "cancelled", color: "#4b5563", label: "Cancelled" },
];

type StepState = {
  stepId: string;
  retryCount: number;
  status: "pending" | "running" | "retrying" | "completed" | "failed" | "skipped" | "cancelled";
  durationMs?: number;
  iteration?: number;
};

type Log = {
  stepId: string;
  message: string;
  level: "info" | "warning" | "error" | "retry" | "system";
  createdAt?: string;
};

type Run = {
  _id: string;
  status: string;
  durationMs?: number;
  workflow: {
    _id: string;
    name: string;
  };
  stepStates: StepState[];
  logs: Log[];
};

type RunUpdatePayload = {
  id: string;
  status: string;
  durationMs?: number;
  currentStepIndex?: number;
  finishedAt?: string;
  stepStates?: StepState[];
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

function getStepColor(stepId: string) {
  let hash = 0;
  for (let i = 0; i < stepId.length; i++) {
    hash = stepId.charCodeAt(i) + ((hash << 5) - hash);
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

  console.log("run", stepStates);
  const logEndRef = useRef<HTMLDivElement>(null);

  // initial fetch
  useEffect(() => {
    if (!runId) return;

    fetch(`http://localhost:4000/runs/${runId}`)
      .then((r) => r.json())
      .then((data: Run) => {
        setRun(data);
        setStepStates(data.stepStates ?? []);
        setLogs(data.logs ?? []);
        setLoading(false);
      });
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
            }
          : prev
      );

      if (summary.stepStates) {
        setStepStates(summary.stepStates);
      }
    };

    const handleLog = (log: Log) => {
      setLogs((prev) => [...prev, log]);
    };

    const handleStepUpdate = (payload: { runId: string; stepId: string; iteration: number; status: string }) => {
      if (payload.runId !== runId) return;
      setStepStates((prev) => {
        const idx = prev.findIndex(
          (s) => s.stepId === payload.stepId && (s.iteration ?? 0) === payload.iteration
        );
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], status: payload.status as StepState["status"] };
        return next;
      });
    };

    socket.on("run:update", handleUpdate);
    socket.on("run:log", handleLog);
    socket.on("step:update", handleStepUpdate);

    return () => {
      socket.emit("run:leave", { runId });
      socket.off("run:update", handleUpdate);
      socket.off("run:log", handleLog);
      socket.off("step:update", handleStepUpdate);
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

    await fetch(`http://localhost:4000/runs/${runId}/cancel`, {
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

  return (
    <div className="pageLayout">
      <header className="pageHeader">
        <div>
          <div className="title">Run: <span className="text-orange">{run.workflow.name}</span> #{run._id}</div>
          <div className="meta">Status: <strong className={`${run.status}`}>{run.status}</strong>  </div>
          <div className="meta">Duration: {run.durationMs ?? 0} ms</div>
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
          <div style={{ marginLeft: 16, display: "flex", alignItems: "center", gap: 8, fontSize: "1.2rem", fontWeight: "bold" }}>
            <label>Replay from:</label>
            <select
              value={replayFromStepId}
              onChange={(e) => setReplayFromStepId(e.target.value)}
              style={{ padding: "4px 8px" }}
            >
              <option value="">Select step</option>
              {replaySteps.map((stepId) => (
                <option key={stepId} value={stepId}>{stepId}</option>
              ))}
            </select>
            <button onClick={handleReplay} disabled={replayLoading || !replayFromStepId}>
              {replayLoading ? "Starting…" : "Replay from here"}
            </button>
          </div>
        )}
      </header>

      <main className="pageContent">
      <div className="pageSection" style={{ marginBottom: 16 }}>
        <div className="sectionTitle">Steps</div>
        <div className="row">
        {stepStates.map((step) => (
          <div key={`${step.stepId}-${step.iteration ?? 0}`} className="stepRow">
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
          {logs
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
              else if (log.message?.startsWith("[STEP TIMEOUT]")) label = "Step timeout";
              else if (log.message?.startsWith("[STEP FAIL]")) label = "Step failed";
              return (
                <div key={i} className="logRow" style={{ marginBottom: 8 }}>
                  <div className="logTime" style={{ minWidth: 80, fontSize: "1.2rem", fontWeight: "bold" }}>
                    {log.createdAt ? new Date(log.createdAt).toLocaleTimeString() : ""}
                  </div>
                  <div className={`logMsg ${logKind(log.level)}`} style={{ fontSize: "1.2rem", fontWeight: "bold" }}>{label}</div>
                  {log.stepId && log.stepId !== "system" && (
                    <span style={{ marginLeft: 8, opacity: 0.8, color: getStepColor(log.level), fontSize: "1.2rem", fontWeight: "bold" }}>[{log.stepId}]</span>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {workflow && (
        <div className="pageSection" style={{ marginBottom: 20, display: "flex", gap: 16 }}>
          <div style={{ flex: 2 }}>
            <div className="sectionTitle">Execution Graph</div>
            <div className="graph-color-info">
              {STATUS_LEGEND.map(({ status, color, label }) => (
                <div key={status} className="graph-color-info__item">
                  <span
                    className="graph-color-info__dot"
                    style={{
                      background: color,
                      boxShadow: ["running","completed","failed","retrying"].includes(status)
                        ? `0 0 6px ${color}`
                        : "none",
                    }}
                  />
                  <span className="graph-color-info__label">{label}</span>
                </div>
              ))}
            </div>
            <WorkflowGraph
              steps={workflow.steps}
              stepStates={stepStates}
              onNodeClick={() => {}}
            />
          </div>
          {runDetail && (
            <div style={{ flex: 1, minWidth: 320, maxHeight: 520 }}>
              <RunDebuggerPanel
                detail={runDetail}
                onReplayFromStep={
                  canReplay && runId
                    ? async (stepId: string) => {
                        try {
                          setReplayLoading(true);
                          const result = await replayRun(runId, stepId);
                          navigate(`/runs/${result.runId}`);
                        } catch (err) {
                          alert(err instanceof Error ? err.message : "Replay failed");
                        } finally {
                          setReplayLoading(false);
                        }
                      }
                    : undefined
                }
              />
            </div>
          )}
        </div>
      )}

      <div className="pageSection">
        <div className="sectionTitle">Logs</div>

        <div className="logPanel">
          {logs.map((log, i) => (
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
                [{log.stepId}]
              </div>

              <div className={`logMsg ${logKind(log.level)}`}>
                {log.message}
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
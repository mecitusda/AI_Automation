import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { socket } from "../api/socket";
import "../styles/runs.css";
import type { WorkflowDetail } from "../api/workflow";
import WorkflowGraph from "../components/WorkflowGraph";
import { fetchWorkflowDetail } from "../api/workflow";

const STATUS_LEGEND = [
  { status: "running",   color: "#3b82f6", label: "Running"   },
  { status: "completed", color: "#22c55e", label: "Completed" },
  { status: "failed",    color: "#ef4444", label: "Failed"    },
  { status: "retrying",  color: "#f59e0b", label: "Retrying"  },
  { status: "pending",   color: "#6b7280", label: "Pending"   },
  { status: "skipped",   color: "#9ca3af", label: "Skipped"   },
  { status: "cancelled", color: "#4b5563", label: "Cancelled" },
];

type StepState = {
  stepId: string;
  retryCount: number;
  status: "pending" | "running" | "retrying" | "completed" | "failed";
  durationMs?: number;
};

type Log = {
  stepId: string;
  message: string;
  level: "info" | "error" | "retry" | "system";
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

  const [run, setRun] = useState<Run | null>(null);
  const [stepStates, setStepStates] = useState<StepState[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

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
      console.log("Received log:", log);
      setLogs((prev) => [...prev, log]);
    };

    socket.on("run:update", handleUpdate);
    socket.on("run:log", handleLog);

    return () => {
      socket.emit("run:leave", { runId });
      socket.off("run:update", handleUpdate);
      socket.off("run:log", handleLog);
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
  if (loading) return <div className="page">Loading...</div>;
  if (!run) return <div className="page">Run not found</div>;

  return (
    <div className="page">
      <div className="header">
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
      </div>

      <div className="section" style={{ marginBottom: 16 }}>
        <div className="sectionTitle">Steps</div>

        {stepStates.map((step) => (
          <div key={step.stepId} className="stepRow">
            <div>
              <div className="stepName">{step.stepId}</div>
              <div className="stepMeta">
                {step.durationMs !== undefined && <span>{step.durationMs} ms</span>}
                {step.retryCount > 0 && <span>Retry: {step.retryCount}</span>}
              </div>
            </div>

            <span className={`stepStatus ${step.status}`}>
              {step.status}
            </span>
          </div>
        ))}
      </div>

      {workflow && (
        <div className="section" style={{ marginBottom: 20 }}>
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
      )}

      <div className="section">
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
    </div>
  );
}
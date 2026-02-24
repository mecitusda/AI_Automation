import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { socket } from "../api/socket";
import "../styles/runs.css";

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
  const [loading, setLoading] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!runId) return;

    fetch(`http://localhost:4000/runs/${runId}`)
      .then((r) => r.json())
      .then((data: Run) => {
        setRun(data);
        setLoading(false);
      });
  }, [runId]);

  useEffect(() => {
    if (!runId) return;

    socket.emit("run:join", { runId });

    const handleUpdate = (summary: RunUpdatePayload) => {
      // detail page yalnızca kendi run'ını günceller
      if (!summary?.id || summary.id !== runId) return;

      setRun((prev) =>
        prev
          ? {
              ...prev,
              status: summary.status ?? prev.status,
              durationMs: summary.durationMs ?? prev.durationMs,
              stepStates: summary.stepStates ?? prev.stepStates,
            }
          : prev
      );
    };

    const handleLog = (log: Log) => {
      setRun((prev) =>
        prev ? { ...prev, logs: [...prev.logs, log] } : prev
      );
    };

    socket.on("run:update", handleUpdate);
    socket.on("run:log", handleLog);

    return () => {
      socket.emit("run:leave", { runId });
      socket.off("run:update", handleUpdate);
      socket.off("run:log", handleLog);
    };
  }, [runId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [run?.logs]);

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

  if (loading) return <div className="page">Loading...</div>;
  if (!run) return <div className="page">Run not found</div>;

  return (
    <div className="page">
      <div className="header">
        <div>
          <div className="title">Run #{run._id}</div>
          <div className="meta">Duration: {run.durationMs ?? 0} ms</div>
        </div>
      </div>

      <div className="section" style={{ marginBottom: 16 }}>
        <div className="sectionTitle">Steps</div>
        {run.stepStates.map((step) => (
          <div key={step.stepId} className="stepRow">
            <div>
              <div className="stepName">{step.stepId}</div>
              <div className="stepMeta">
                {step.durationMs !== undefined && <span>{step.durationMs} ms</span>}
                {step.retryCount > 0 && <span>Retry: {step.retryCount}</span>}
              </div>
            </div>
            <span className={`stepStatus ${step.status}`}>{step.status}</span>
          </div>
        ))}
      </div>

      <div className="section">
        <div className="sectionTitle">Logs</div>

        <div className="logPanel">
          {run.logs.map((log, i) => (
            <div key={i} className="logRow">
              <div className="logTime">
                {log.createdAt ? new Date(log.createdAt).toLocaleTimeString() : ""}
              </div>
              <div className="logStep" style={{ color: getStepColor(log.stepId) }}>
                [{log.stepId}]
              </div>
              <div className={`logMsg ${logKind(log.level)}`}>{log.message}</div>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { socket } from "../api/socket";
import "../styles/runs.css";

type StepState = {
  stepId: string;
  retryCount: number;
  status: "pending" | "running" | "retrying" | "completed" | "failed";
  durationMs?: number;
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

  useEffect(() => {
    fetch("http://localhost:4000/runs")
      .then((r) => r.json())
      .then((data: Run[]) => {
        setRuns(data);
        setLoading(false);
      });
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

    socket.on("run:update", handleRunUpdate);

    return () => {
      socket.off("run:update", handleRunUpdate);
    };
  }, []);

  const progressPercent = (run: Run) => {
    if (!run.stepStates?.length) return 0;
    const completed = run.stepStates.filter((s) => s.status === "completed").length;
    return Math.round((completed / run.stepStates.length) * 100);
  };

  if (loading) return <div className="page">Loading runs...</div>;

  return (
    <div className="page">
      <div className="header">
        <h1 className="title">Workflow Runs</h1>
        <div className="meta">Total: {runs.length}</div>
      </div>

      <div className="grid">
        {runs.map((run) => {
          const pct = progressPercent(run);

          return (
            <Link key={run._id} to={`/runs/${run._id}`} className="cardLink">
              <div className="card">
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
                  {run.stepStates?.map((step) => (
                    <span key={step.stepId} className={`stepBadge ${step.status}`}>
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
    </div>
  );
}
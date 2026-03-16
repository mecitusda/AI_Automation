import { useMemo, useState } from "react";
import type { RunDetail, RunDetailStepState } from "../api/run";

type RunDebuggerPanelProps = {
  detail: RunDetail;
  onReplayFromStep?: (stepId: string) => void;
};

type StepInstance = {
  stepId: string;
  type: string;
  status: string;
  iteration: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  retryCount?: number;
  executionId?: string;
  output?: unknown;
};

export default function RunDebuggerPanel({ detail, onReplayFromStep }: RunDebuggerPanelProps) {
  const instances = useMemo<StepInstance[]>(() => {
    const stepById = new Map(detail.steps.map((s) => [s.id, s]));
    const outputs = detail.outputs || {};

    return detail.stepStates.map((st: RunDetailStepState) => {
      const meta = stepById.get(st.stepId);
      const outputForStep = outputs[st.stepId];
      const output =
        outputForStep && typeof outputForStep === "object"
          ? (outputForStep as any)[String(st.iteration)] ?? outputForStep
          : outputForStep;

      return {
        stepId: st.stepId,
        type: meta?.type ?? "unknown",
        status: st.status,
        iteration: st.iteration ?? 0,
        startedAt: st.startedAt,
        finishedAt: st.finishedAt,
        durationMs: st.durationMs,
        retryCount: st.retryCount,
        executionId: st.executionId,
        output,
      };
    });
  }, [detail]);

  const representativeByStep = useMemo(() => {
    const map = new Map<string, StepInstance>();
    for (const inst of instances) {
      const prev = map.get(inst.stepId);
      if (!prev || inst.iteration >= prev.iteration) {
        map.set(inst.stepId, inst);
      }
    }
    return map;
  }, [instances]);

  const [selectedStepId, setSelectedStepId] = useState<string | null>(() => {
    const first = detail.steps[0];
    return first?.id ?? null;
  });

  const selectedInstance = useMemo(() => {
    if (!selectedStepId) return null;
    return representativeByStep.get(selectedStepId) ?? null;
  }, [selectedStepId, representativeByStep]);

  return (
    <div style={{ padding: 12, overflow: "auto", height: "100%", background: "#0b1220" }}>
      <h3 style={{ margin: "0 0 8px 0", fontSize: 14 }}>Run debugger</h3>
      <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          Status: {detail.status} • Version {detail.workflowVersion}
        </span>
        {onReplayFromStep && selectedStepId && (
          <button
            type="button"
            onClick={() => onReplayFromStep(selectedStepId)}
            style={{
              padding: "2px 8px",
              borderRadius: 6,
              border: "1px solid #374151",
              background: "#1f2937",
              color: "#93c5fd",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Replay from here
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, height: "calc(100% - 40px)" }}>
        <div style={{ flex: 1, minWidth: 140, borderRight: "1px solid #1f2937", paddingRight: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Steps</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: "100%", overflowY: "auto" }}>
            {detail.steps.map((s) => {
              const inst = representativeByStep.get(s.id);
              const isSelected = s.id === selectedStepId;
              const status = inst?.status ?? "pending";
              return (
                <li key={s.id} style={{ marginBottom: 2 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedStepId(s.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "4px 6px",
                      borderRadius: 4,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 12,
                      background: isSelected ? "#1f2937" : "transparent",
                      color: "#e5e7eb",
                    }}
                  >
                    <span style={{ marginRight: 4 }}>{statusBadge(status)}</span>
                    {s.id} <span style={{ color: "#9ca3af" }}>({s.type})</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div style={{ flex: 2, paddingLeft: 8, overflowY: "auto" }}>
          {selectedInstance ? (
            <>
              <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500 }}>
                {selectedInstance.stepId} ({selectedInstance.type}) {statusBadge(selectedInstance.status)}
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>
                Iteration {selectedInstance.iteration} • retries {selectedInstance.retryCount ?? 0} • duration{" "}
                {selectedInstance.durationMs != null ? `${selectedInstance.durationMs} ms` : "n/a"}
              </div>

              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2 }}>Input (previousOutput)</div>
                {(() => {
                  const stepMeta = detail.steps.find((s) => s.id === selectedInstance.stepId);
                  const depIds = stepMeta?.dependsOn ?? [];
                  if (depIds.length === 0) {
                    return <div style={{ fontSize: 12, color: "#9ca3af" }}>No dependencies.</div>;
                  }
                  const input: Record<string, unknown> = {};
                  for (const depId of depIds) {
                    const out = detail.outputs?.[depId];
                    input[depId] = out != null ? out : undefined;
                  }
                  return (
                    <pre
                      style={{
                        margin: 0,
                        padding: 8,
                        borderRadius: 6,
                        background: "#020617",
                        border: "1px solid #1f2937",
                        fontSize: 11,
                        maxHeight: 160,
                        overflow: "auto",
                      }}
                    >
                      {JSON.stringify(input, null, 2)}
                    </pre>
                  );
                })()}
              </div>

              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2 }}>Logs</div>
                {(() => {
                  const stepLogs = (detail.logs ?? []).filter((l) => l.stepId === selectedInstance.stepId);
                  if (stepLogs.length === 0) {
                    return <div style={{ fontSize: 12, color: "#9ca3af" }}>No logs for this step.</div>;
                  }
                  return (
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 11 }}>
                      {stepLogs.map((l, i) => (
                        <li
                          key={i}
                          style={{
                            padding: "4px 6px",
                            marginBottom: 2,
                            background: "#0f172a",
                            borderRadius: 4,
                            borderLeft: `3px solid ${l.level === "error" ? "#ef4444" : l.level === "warning" ? "#f59e0b" : "#374151"}`,
                          }}
                        >
                          <span style={{ color: "#9ca3af" }}>{l.level}</span> {l.message}
                          {l.createdAt && (
                            <span style={{ color: "#6b7280", fontSize: 10, marginLeft: 6 }}>
                              {new Date(l.createdAt).toLocaleString()}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>

              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2 }}>Output</div>
                {selectedInstance.output === undefined ? (
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>No output recorded.</div>
                ) : (
                  <pre
                    style={{
                      margin: 0,
                      padding: 8,
                      borderRadius: 6,
                      background: "#020617",
                      border: "1px solid #1f2937",
                      fontSize: 11,
                      maxHeight: 220,
                      overflow: "auto",
                    }}
                  >
                    {JSON.stringify(selectedInstance.output, null, 2)}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "#9ca3af" }}>Select a step to inspect.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; color: string }> = {
    running: { label: "●", color: "#f59e0b" },
    completed: { label: "✔", color: "#22c55e" },
    failed: { label: "✖", color: "#ef4444" },
    skipped: { label: "⤼", color: "#9ca3af" },
    pending: { label: "●", color: "#6b7280" },
    cancelled: { label: "✖", color: "#9ca3af" },
  };
  const meta = map[status] ?? map.pending;
  return (
    <span style={{ color: meta.color, marginRight: 2 }} title={status}>
      {meta.label}
    </span>
  );
}


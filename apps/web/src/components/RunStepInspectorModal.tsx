import { useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import type { RunDetail, RunDetailStep } from "../api/run";
import { shouldShowSeparateLogError } from "../utils/runLogDisplay";

type InspectorTab = "resolved" | "deps" | "output" | "errors";

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

export type RunStepInspectorModalProps = {
  open: boolean;
  onClose: () => void;
  detail: RunDetail | null;
  stepId: string | null;
};

function statusMeta(status: string): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    running: { label: "Running", className: "runInspectorModal__pill runInspectorModal__pill--running" },
    completed: { label: "Completed", className: "runInspectorModal__pill runInspectorModal__pill--completed" },
    failed: { label: "Failed", className: "runInspectorModal__pill runInspectorModal__pill--failed" },
    retrying: { label: "Retrying", className: "runInspectorModal__pill runInspectorModal__pill--retrying" },
    skipped: { label: "Skipped", className: "runInspectorModal__pill runInspectorModal__pill--skipped" },
    pending: { label: "Pending", className: "runInspectorModal__pill runInspectorModal__pill--pending" },
    cancelled: { label: "Cancelled", className: "runInspectorModal__pill runInspectorModal__pill--cancelled" },
  };
  return map[status] ?? map.pending;
}

function useStepInstances(detail: RunDetail | null): Map<string, StepInstance> {
  return useMemo(() => {
    const map = new Map<string, StepInstance>();
    if (!detail) return map;
    const stepById = new Map(detail.steps.map((s) => [s.id, s]));
    const outputs = detail.outputs || {};

    for (const st of detail.stepStates) {
      const meta = stepById.get(st.stepId);
      const outputForStep = outputs[st.stepId];
      const output =
        outputForStep && typeof outputForStep === "object"
          ? (outputForStep as Record<string, unknown>)[String(st.iteration)] ?? outputForStep
          : outputForStep;

      const inst: StepInstance = {
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
      const prev = map.get(st.stepId);
      if (!prev || inst.iteration >= prev.iteration) {
        map.set(st.stepId, inst);
      }
    }
    return map;
  }, [detail]);
}

export default function RunStepInspectorModal({
  open,
  onClose,
  detail,
  stepId,
}: RunStepInspectorModalProps) {
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("resolved");
  const representativeByStep = useStepInstances(detail);

  useEffect(() => {
    if (open) setInspectorTab("resolved");
  }, [open, stepId]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [open, onKeyDown]);

  if (!open || !stepId) return null;

  const stepMeta = detail?.steps.find((s) => s.id === stepId) as RunDetailStep | undefined;
  const selectedInstance = representativeByStep.get(stepId) ?? null;
  const status = selectedInstance?.status ?? "pending";
  const pill = statusMeta(status);

  const modal = (
    <div
      className="runInspectorModal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-inspector-title"
    >
      <div
        className="runInspectorModal__backdrop"
        onClick={onClose}
        role="presentation"
        aria-hidden="true"
      />
      <div className="runInspectorModal__panel" onClick={(e) => e.stopPropagation()}>
        <header className="runInspectorModal__header">
          <div className="runInspectorModal__headerMain">
            <p className="runInspectorModal__eyebrow">Step inspection</p>
            <h2 id="run-inspector-title" className="runInspectorModal__title">
              {stepId}
            </h2>
            <div className="runInspectorModal__subtitle">
              <span className="runInspectorModal__type">{stepMeta?.type ?? "step"}</span>
              <span className={pill.className}>{pill.label}</span>
              {detail && (
                <span className="runInspectorModal__version">Workflow run · v{detail.workflowVersion}</span>
              )}
            </div>
            {selectedInstance && (
              <p className="runInspectorModal__meta">
                Iteration {selectedInstance.iteration}
                <span className="runInspectorModal__metaDot" aria-hidden />
                Retries {selectedInstance.retryCount ?? 0}
                <span className="runInspectorModal__metaDot" aria-hidden />
                {selectedInstance.durationMs != null
                  ? `${selectedInstance.durationMs} ms`
                  : "Duration n/a"}
              </p>
            )}
          </div>
          <button type="button" className="modalCloseButton" onClick={onClose} aria-label="Close inspector">
          ×
        </button>
        </header>

        {detail && selectedInstance ? (
          <nav className="runInspectorModal__tabBar" aria-label="Inspector sections" role="tablist">
            {(
              [
                ["resolved", "Resolved input"],
                ["deps", "Upstream outputs"],
                ["output", "Output & meta"],
                ["errors", "Logs & errors"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`run-inspector-tab-${id}`}
                aria-selected={inspectorTab === id}
                aria-controls="run-inspector-tabpanel-main"
                className={
                  inspectorTab === id
                    ? "runInspectorModal__tab runInspectorModal__tab--active"
                    : "runInspectorModal__tab"
                }
                onClick={() => setInspectorTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        ) : null}

        <div className="runInspectorModal__body">
          {!detail && (
            <div className="runInspectorModal__loading">
              <div className="runInspectorModal__spinner" />
              <p>Loading step details…</p>
            </div>
          )}

          {detail && !selectedInstance && (
            <p className="runInspectorModal__empty">No execution state for this step in this run.</p>
          )}

          {detail && selectedInstance && (
            <div
              className="runInspectorModal__tabPanel"
              id="run-inspector-tabpanel-main"
              role="tabpanel"
              aria-labelledby={`run-inspector-tab-${inspectorTab}`}
            >
              {inspectorTab === "resolved" ? (
                <ResolvedInputTab detail={detail} instance={selectedInstance} />
              ) : null}
              {inspectorTab === "deps" ? (
                <DepsTab detail={detail} instance={selectedInstance} />
              ) : null}
              {inspectorTab === "errors" ? (
                <ErrorsTab detail={detail} instance={selectedInstance} />
              ) : null}
              {inspectorTab === "output" ? <OutputTab instance={selectedInstance} /> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function ResolvedInputTab({
  detail,
  instance,
}: {
  detail: RunDetail;
  instance: StepInstance;
}) {
  const stepKey = `${instance.stepId}::${instance.iteration}`;
  const entry = detail.stepInputs?.[stepKey];
  if (!entry?.params || Object.keys(entry.params).length === 0) {
    if (instance.status === "running" || instance.status === "pending") {
      return (
        <p className="runInspectorModal__hint">
          Resolved parameters appear when the step starts running.
        </p>
      );
    }
    return <p className="runInspectorModal__hint">No resolved input snapshot for this execution.</p>;
  }
  return (
    <div>
      <p className="runInspectorModal__sectionLabel">
        Parameters after <code>{"{{ }}"}</code> substitution (secrets redacted)
      </p>
      {entry.startedAt ? (
        <p className="runInspectorModal__capture">Captured {entry.startedAt}</p>
      ) : null}
      <pre className="runInspectorModal__pre">{JSON.stringify(entry.params, null, 2)}</pre>
    </div>
  );
}

function DepsTab({ detail, instance }: { detail: RunDetail; instance: StepInstance }) {
  const stepMeta = detail.steps.find((s) => s.id === instance.stepId);
  const depIds = stepMeta?.dependsOn ?? [];
  if (depIds.length === 0) {
    return <p className="runInspectorModal__hint">This step has no dependencies.</p>;
  }
  const input: Record<string, unknown> = {};
  for (const depId of depIds) {
    const out = detail.outputs?.[depId];
    input[depId] = out != null ? out : undefined;
  }
  return (
    <div>
      <p className="runInspectorModal__sectionLabel">Outputs from upstream steps (dependsOn)</p>
      <pre className="runInspectorModal__pre">{JSON.stringify(input, null, 2)}</pre>
    </div>
  );
}

function ErrorsTab({ detail, instance }: { detail: RunDetail; instance: StepInstance }) {
  const stepLogs = (detail.logs ?? []).filter((l) => l.stepId === instance.stepId);
  return (
    <div>
      <p className="runInspectorModal__sectionLabel">Timeline for this step</p>
      {stepLogs.length === 0 ? (
        <p className="runInspectorModal__hint">No log lines for this step.</p>
      ) : (
        <ul className="runInspectorModal__logList">
          {stepLogs.map((l, i) => (
            <li
              key={i}
              className={`runInspectorModal__logItem runInspectorModal__logItem--${l.level === "error" ? "error" : l.level === "warning" ? "warning" : "default"}`}
            >
              <div className="runInspectorModal__logRow">
                <span className="runInspectorModal__logLevel">{l.level}</span>
                <span className="runInspectorModal__logMsg">{l.message}</span>
                {l.createdAt ? (
                  <time className="runInspectorModal__logTime" dateTime={l.createdAt}>
                    {new Date(l.createdAt).toLocaleString()}
                  </time>
                ) : null}
              </div>
              <div className="runInspectorModal__logMeta">
                {l.status ? <span>status={String(l.status)}</span> : null}
                {l.attempt != null ? <span>attempt={String(l.attempt)}</span> : null}
                {l.durationMs != null ? <span>{l.durationMs} ms</span> : null}
              </div>
              {shouldShowSeparateLogError(l.message, l.error) ? (
                <div className="runInspectorModal__logErr">{String(l.error)}</div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {detail.lastError?.stepId === instance.stepId &&
      (detail.lastError.iteration ?? 0) === instance.iteration ? (
        <div className="runInspectorModal__lastError">
          <div className="runInspectorModal__sectionLabel">Workflow lastError</div>
          <pre className="runInspectorModal__pre runInspectorModal__pre--error">
            {detail.lastError.message ?? ""}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function OutputTab({ instance }: { instance: StepInstance }) {
  if (instance.status === "running" || instance.status === "pending") {
    return (
      <p className="runInspectorModal__hint">Output is available after the step finishes.</p>
    );
  }
  if (instance.output === undefined) {
    return <p className="runInspectorModal__hint">No output recorded.</p>;
  }
  const raw = instance.output as Record<string, unknown> | undefined;
  const isCanonical = raw && "success" in raw && "output" in raw;
  const displayOutput = isCanonical ? raw.output : raw;
  const meta =
    isCanonical && raw?.meta && typeof raw.meta === "object"
      ? (raw.meta as Record<string, unknown>)
      : undefined;
  const hasMeta = !!meta && Object.keys(meta).length > 0;
  return (
    <div className="runInspectorModal__outputGrid">
      <div>
        <p className="runInspectorModal__sectionLabel">Meta</p>
        {hasMeta ? (
          <pre className="runInspectorModal__pre runInspectorModal__pre--short">
            {JSON.stringify(meta, null, 2)}
          </pre>
        ) : (
          <p className="runInspectorModal__hint">No meta.</p>
        )}
      </div>
      <div>
        <p className="runInspectorModal__sectionLabel">Output</p>
        <pre className="runInspectorModal__pre">{JSON.stringify(displayOutput, null, 2)}</pre>
      </div>
    </div>
  );
}

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

function stepIds(steps: Array<{ id: string }> | undefined | null): string[] {
  return Array.isArray(steps) ? steps.map((s) => s.id) : [];
}

function missingStepIds(prev: Array<{ id: string }>, next: Array<{ id: string }>): string[] {
  if (!prev.length) return [];
  const nextIdSet = new Set(next.map((s) => s.id));
  return prev.filter((s) => !nextIdSet.has(s.id)).map((s) => s.id);
}

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
  const RUN_UPDATE_THROTTLE_MS = 300;
  const STEP_UPDATE_FLUSH_MS = 250;
  const LOG_FLUSH_MS = 400;

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
  const [pendingLogCount, setPendingLogCount] = useState(0);

  const logPanelRef = useRef<HTMLDivElement>(null);
  const detailRefreshTimerRef = useRef<number | null>(null);
  const detailRefreshDueAtRef = useRef<number | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const detailReqSeqRef = useRef(0);
  const lastRunStatusRef = useRef<string | null>(null);
  const runUpdateFlushTimerRef = useRef<number | null>(null);
  const stepUpdateFlushTimerRef = useRef<number | null>(null);
  const logFlushTimerRef = useRef<number | null>(null);
  const pendingRunSummaryRef = useRef<RunUpdatePayload | null>(null);
  const pendingStepUpdatesRef = useRef<Array<{ stepId: string; iteration: number; status: string }>>([]);
  const pendingLogsRef = useRef<Log[]>([]);
  const prevLogCountRef = useRef(0);
  const lastNonEmptyWorkflowRef = useRef<WorkflowDetail | null>(null);
  const lastNonEmptyGraphStepsRef = useRef<WorkflowDetail["steps"]>([]);
  const lockedRunningGraphStepsRef = useRef<WorkflowDetail["steps"]>([]);
  const graphEverRenderedRef = useRef(false);
  const pinnedGraphSourceRef = useRef<"runDetail" | "workflow" | "cached" | "">("");
  const graphDebugRef = useRef({ emits: 0, lastWorkflowSteps: -1, lastStateCount: -1 });
  const detailDebugRef = useRef({ emits: 0, fetches: 0, sourceTransitions: 0, lastSource: "", scheduled: 0 });

  // initial fetch
  useEffect(() => {
    if (!runId) return;

    apiFetch<Run>(`/runs/${runId}`)
      .then((data: Run) => {
        setRun(data);
        setStepStates(data.stepStates ?? []);
        const initialLogs = data.logs ?? [];
        prevLogCountRef.current = initialLogs.length;
        setPendingLogCount(0);
        setLogs(initialLogs);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [runId]);

  const scheduleRunDetailRefresh = (delayMs = 600, reason = "unknown") => {
    if (!runId) return;
    const now = Date.now();
    const nextDueAt = now + Math.max(0, delayMs);
    const hasPending = detailRefreshTimerRef.current != null;
    const currentDueAt = detailRefreshDueAtRef.current;
    // Coalesce refreshes: keep the earliest pending execution instead of re-queuing every event.
    if (hasPending && currentDueAt != null && currentDueAt <= nextDueAt) {
      return;
    }
    if (detailRefreshTimerRef.current != null) {
      window.clearTimeout(detailRefreshTimerRef.current);
    }
    detailRefreshDueAtRef.current = nextDueAt;
    if (detailDebugRef.current.scheduled < 120) {
      detailDebugRef.current.scheduled += 1;
      console.warn("[RunDetailRefreshScheduled]", {
        runId,
        reason,
        delayMs,
        scheduled: detailDebugRef.current.scheduled,
      });
    }
    detailRefreshTimerRef.current = window.setTimeout(() => {
      const reqSeq = ++detailReqSeqRef.current;
      if (detailAbortRef.current) {
        detailAbortRef.current.abort();
      }
      const controller = new AbortController();
      detailAbortRef.current = controller;
      fetchRunDetail(runId, { signal: controller.signal })
        .then((d) => {
          if (reqSeq !== detailReqSeqRef.current) {
            if (detailDebugRef.current.fetches < 80) {
              detailDebugRef.current.fetches += 1;
              console.warn("[RunDetailFetchStaleResponseIgnored]", {
                runId,
                seq: reqSeq,
                latestSeq: detailReqSeqRef.current,
                reason,
              });
            }
            return;
          }
          if (detailDebugRef.current.fetches < 80) {
            detailDebugRef.current.fetches += 1;
            console.warn("[RunDetailFetchDebug]", {
              runId,
              seq: reqSeq,
              reason,
              status: d.status,
              topologySource: d.topologySource ?? "unknown",
              steps: d.steps?.length ?? 0,
              stepIds: stepIds(d.steps).slice(0, 20),
              stepStates: d.stepStates?.length ?? 0,
            });
          }
          setRunDetail((prev) => {
            const prevSteps = prev?.steps ?? [];
            const nextSteps = d.steps ?? [];
            if (nextSteps.length === 0 && prevSteps.length > 0) {
              console.warn("[RunDetailTopologyRegressionBlocked]", {
                runId,
                seq: reqSeq,
                reason,
                previousCount: prevSteps.length,
                nextCount: 0,
                blockedBecause: "empty_steps",
                prevStepIds: stepIds(prevSteps).slice(0, 20),
              });
              return { ...d, steps: prevSteps };
            }
            const missingIds = missingStepIds(prevSteps, nextSteps);
            const isRunning = d.status === "running";
            if (isRunning && prevSteps.length > 0 && nextSteps.length > 0 && missingIds.length > 0) {
              console.warn("[RunDetailTopologyRegressionBlocked]", {
                runId,
                seq: reqSeq,
                reason,
                topologySource: d.topologySource ?? "unknown",
                previousCount: prevSteps.length,
                nextCount: nextSteps.length,
                missingCount: missingIds.length,
                missingIds: missingIds.slice(0, 20),
              });
              return { ...d, steps: prevSteps };
            }
            return d;
          });
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          if (import.meta.env.DEV) {
            console.debug("[RunDetailFetchError]", err);
          }
        })
        .finally(() => {
          if (detailAbortRef.current === controller) {
            detailAbortRef.current = null;
          }
        });
      detailRefreshTimerRef.current = null;
      detailRefreshDueAtRef.current = null;
    }, delayMs);
  };

  // fetch detailed run snapshot for debugger/output inspection
  useEffect(() => {
    if (!runId) return;
    lockedRunningGraphStepsRef.current = [];
    scheduleRunDetailRefresh(0, "initial-load");
  }, [runId]);

  // Controlled polling while running to avoid websocket-driven refresh storms.
  useEffect(() => {
    if (!runId) return;
    if (run?.status !== "running" && run?.status !== "retrying") return;
    const timer = window.setInterval(() => {
      scheduleRunDetailRefresh(1200, "poll:running");
    }, 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [runId, run?.status]);
  
  // socket listeners
  useEffect(() => {
    if (!runId) return;

    socket.emit("run:join", { runId });

    const handleUpdate = (summary: RunUpdatePayload) => {
      if (!summary?.id || summary.id !== runId) return;
      pendingRunSummaryRef.current = summary;
      if (runUpdateFlushTimerRef.current != null) return;
      runUpdateFlushTimerRef.current = window.setTimeout(() => {
        const nextSummary = pendingRunSummaryRef.current;
        pendingRunSummaryRef.current = null;
        runUpdateFlushTimerRef.current = null;
        if (!nextSummary) return;
        const prevStatus = lastRunStatusRef.current;
        const nextStatus = nextSummary.status ?? prevStatus ?? "";
        lastRunStatusRef.current = nextStatus;
        setRun((prev) =>
          prev
            ? {
                ...prev,
                status: nextSummary.status ?? prev.status,
                durationMs: nextSummary.durationMs ?? prev.durationMs,
                loopState: nextSummary.loopState ?? prev.loopState,
              }
            : prev
        );
        if (nextSummary.stepStates) {
          setStepStates(nextSummary.stepStates);
        }
        // Refresh immediately only on lifecycle transitions.
        if (prevStatus !== nextStatus || nextStatus === "completed" || nextStatus === "failed" || nextStatus === "cancelled") {
          scheduleRunDetailRefresh(0, "socket:run:update:status-transition");
        }
      }, RUN_UPDATE_THROTTLE_MS);
    };

    const handleLog = (log: Log) => {
      pendingLogsRef.current.push(log);
      if (logFlushTimerRef.current != null) return;
      logFlushTimerRef.current = window.setTimeout(() => {
        const batch = pendingLogsRef.current;
        pendingLogsRef.current = [];
        logFlushTimerRef.current = null;
        if (!batch.length) return;
        setLogs((prev) => [...prev, ...batch]);
      }, LOG_FLUSH_MS);
    };

    const handleStepUpdate = (payload: { runId: string; stepId: string; iteration: number; status: string }) => {
      if (payload.runId !== runId) return;
      pendingStepUpdatesRef.current.push({
        stepId: payload.stepId,
        iteration: payload.iteration,
        status: payload.status,
      });
      if (stepUpdateFlushTimerRef.current != null) return;
      stepUpdateFlushTimerRef.current = window.setTimeout(() => {
        const updates = pendingStepUpdatesRef.current;
        pendingStepUpdatesRef.current = [];
        stepUpdateFlushTimerRef.current = null;
        if (!updates.length) return;
        setStepStates((prev) => {
          const next = [...prev];
          for (const update of updates) {
            const idx = next.findIndex(
              (s) => s.stepId === update.stepId && (s.iteration ?? 0) === update.iteration
            );
            if (idx < 0) {
              next.push({
                stepId: update.stepId,
                iteration: update.iteration,
                retryCount: 0,
                status: update.status as StepState["status"],
              });
            } else {
              next[idx] = { ...next[idx], status: update.status as StepState["status"] };
            }
          }
          return next;
        });
      }, STEP_UPDATE_FLUSH_MS);
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
      if (detailAbortRef.current) {
        detailAbortRef.current.abort();
        detailAbortRef.current = null;
      }
      if (runUpdateFlushTimerRef.current != null) {
        window.clearTimeout(runUpdateFlushTimerRef.current);
        runUpdateFlushTimerRef.current = null;
      }
      if (stepUpdateFlushTimerRef.current != null) {
        window.clearTimeout(stepUpdateFlushTimerRef.current);
        stepUpdateFlushTimerRef.current = null;
      }
      if (logFlushTimerRef.current != null) {
        window.clearTimeout(logFlushTimerRef.current);
        logFlushTimerRef.current = null;
      }
      pendingRunSummaryRef.current = null;
      pendingStepUpdatesRef.current = [];
      pendingLogsRef.current = [];
    };
  }, [runId]);

  // Track new logs without auto-scrolling the panel.
  useEffect(() => {
    const prev = prevLogCountRef.current;
    const delta = logs.length - prev;
    prevLogCountRef.current = logs.length;

    if (delta <= 0) return;
    setPendingLogCount((count) => count + delta);
  }, [logs]);

  const handleLogPanelScroll = () => {
    const panel = logPanelRef.current;
    if (!panel) return;
    const threshold = 24;
    const atBottom = panel.scrollHeight - (panel.scrollTop + panel.clientHeight) <= threshold;
    if (atBottom) {
      setPendingLogCount(0);
    }
  };

  const jumpToLatestLog = () => {
    const panel = logPanelRef.current;
    if (!panel) return;
    panel.scrollTop = panel.scrollHeight;
    setPendingLogCount(0);
  };

  // fetch workflow
  useEffect(() => {
    if (!run?.workflow?._id) return;

    fetchWorkflowDetail(run.workflow._id)
      .then((wf) => {
        setWorkflow(wf);
        if (Array.isArray(wf?.steps) && wf.steps.length > 0) {
          lastNonEmptyWorkflowRef.current = wf;
        }
      })
      .catch(() => {});
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
  const loopProgressByStep = useMemo(() => Object.fromEntries(
    Object.entries(run?.loopState || {}).map(([stepId, state]) => {
      const total = Array.isArray(state?.items) ? state.items.length : 0;
      const index = Number(state?.index ?? 0);
      const current = total > 0 ? Math.min(index + 1, total) : 0;
      return [stepId, { current, total }];
    })
  ), [run?.loopState]);
  const graphWorkflow = useMemo(() => {
    if (workflow && Array.isArray(workflow.steps) && workflow.steps.length > 0) {
      return workflow;
    }
    return lastNonEmptyWorkflowRef.current;
  }, [workflow]);
  const runDetailGraphSteps = useMemo<WorkflowDetail["steps"]>(() => {
    return (runDetail?.steps ?? []).map((s) => ({
      id: s.id,
      type: s.type,
      dependsOn: s.dependsOn,
      dependencyModes: s.dependencyModes,
      branch: s.branch,
      errorFrom: s.errorFrom,
      retry: s.retry,
      timeout: s.timeout,
      params: s.params as Record<string, any> | undefined,
      disabled: s.disabled,
    }));
  }, [runDetail?.steps]);
  const graphSteps = useMemo<WorkflowDetail["steps"]>(() => {
    const workflowSteps = Array.isArray(graphWorkflow?.steps) ? graphWorkflow.steps : [];
    const cachedSteps = lastNonEmptyGraphStepsRef.current;
    const lockedSteps = lockedRunningGraphStepsRef.current;
    const isRunActive = run?.status === "running" || run?.status === "retrying";

    // 1) Pick the freshest non-empty source. runDetail wins over workflow.
    let candidate: WorkflowDetail["steps"];
    let source: "runDetail" | "workflow" | "cached" = "cached";
    if (runDetailGraphSteps.length > 0) {
      candidate = runDetailGraphSteps;
      source = "runDetail";
    } else if (workflowSteps.length > 0) {
      candidate = workflowSteps;
      source = "workflow";
    } else {
      candidate = cachedSteps;
    }

    // 2) Topology lock: while the run is active we keep showing the first
    //    non-empty topology we observed to prevent flicker from rapid socket
    //    updates or transient empty payloads.
    if (isRunActive && lockedSteps.length > 0) {
      // If a fresher source dropped steps that the lock still has, prefer the
      // lock (regression guard). Otherwise stick with the lock to avoid
      // mid-run topology churn.
      if (source !== "cached" && candidate.length > 0) {
        const missingFromCandidate = missingStepIds(lockedSteps, candidate);
        const candidateHasMore = missingStepIds(candidate, lockedSteps).length > 0;
        if (missingFromCandidate.length === 0 && candidateHasMore) {
          // Candidate strictly extends the locked set -> upgrade the lock.
          // Useful when dynamic steps appear during a long run.
        } else {
          candidate = lockedSteps;
          source = "cached";
        }
      } else {
        candidate = lockedSteps;
        source = "cached";
      }
    }

    // 3) Final safety net: never hand back an empty array if we have any
    //    cached topology. This is what protects the graph from briefly
    //    "emptying out" when sockets fire status transitions faster than the
    //    detail fetch can return.
    if (candidate.length === 0 && cachedSteps.length > 0) {
      candidate = cachedSteps;
      source = "cached";
    }

    return candidate;
  }, [graphWorkflow?.steps, runDetailGraphSteps, run?.status]);

  // Derive the source of `graphSteps` for cache/pin/lock book-keeping. Side
  // effects must live outside `useMemo` so concurrent renders / StrictMode
  // double-invocation cannot corrupt the persistent refs.
  useEffect(() => {
    if (graphSteps.length === 0) return;
    lastNonEmptyGraphStepsRef.current = graphSteps;

    const isRunActive = run?.status === "running" || run?.status === "retrying";
    if (isRunActive && lockedRunningGraphStepsRef.current.length === 0) {
      lockedRunningGraphStepsRef.current = graphSteps;
    } else if (!isRunActive) {
      // After the run finishes we let the lock follow the latest topology so
      // a future re-entry into "running" (e.g. retry) starts fresh.
      lockedRunningGraphStepsRef.current = graphSteps;
    }

    let nextSource: "runDetail" | "workflow" | "" = "";
    if (runDetailGraphSteps.length > 0 && runDetailGraphSteps === graphSteps) {
      nextSource = "runDetail";
    } else if (
      Array.isArray(graphWorkflow?.steps) &&
      graphWorkflow.steps === graphSteps
    ) {
      nextSource = "workflow";
    }
    if (nextSource && pinnedGraphSourceRef.current !== nextSource) {
      pinnedGraphSourceRef.current = nextSource;
    }

    if (
      !import.meta.env.PROD &&
      detailDebugRef.current.sourceTransitions < 80 &&
      detailDebugRef.current.lastSource !== (nextSource || "cached")
    ) {
      detailDebugRef.current.sourceTransitions += 1;
      detailDebugRef.current.lastSource = nextSource || "cached";
      console.debug("[RunDetailGraphSource]", {
        runId,
        source: nextSource || "cached",
        stepCount: graphSteps.length,
        locked: lockedRunningGraphStepsRef.current.length,
      });
    }
  }, [graphSteps, graphWorkflow?.steps, runDetailGraphSteps, run?.status, runId]);
  const graphStepStates = useMemo(() => stepStates, [stepStates]);
  const graphLoopProgressByStep = useMemo(() => loopProgressByStep, [loopProgressByStep]);
  const graphFailureHintByStepId = useMemo(() => failureHintByStepId, [failureHintByStepId]);
  useEffect(() => {
    if (graphSteps.length > 0) {
      graphEverRenderedRef.current = true;
    }
  }, [graphSteps.length]);

  useEffect(() => {
    if (import.meta.env.PROD) return;
    const workflowStepCount = graphSteps.length;
    const stateCount = Object.keys(graphStepStates).length;
    const dbg = graphDebugRef.current;
    const changed = dbg.lastWorkflowSteps !== workflowStepCount || dbg.lastStateCount !== stateCount;
    if (!changed || dbg.emits >= 30) return;
    dbg.lastWorkflowSteps = workflowStepCount;
    dbg.lastStateCount = stateCount;
    dbg.emits += 1;
    console.debug("[RunDetailGraphDebug]", {
      emit: dbg.emits,
      workflowStepCount,
      stepStateCount: stateCount
    });
  }, [graphSteps, graphStepStates]);

  if (loading) return <div className="pageLayout"><div className="spinner" /></div>;
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
      <div className="pageSection" style={{ marginBottom: 16, maxHeight: "500px", overflowY: "auto" }}>
        <div className="sectionTitle">Steps</div>
        <div className="runDetailFilters">
          <label className="runDetailFilters__label">Status filter:</label>
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

      <div className="pageSection" style={{ marginBottom: 16, maxHeight: "500px", overflowY: "auto" }}>
        <div className="sectionTitle">Run Timeline</div>
        <div className="timelinePanel">
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
                <div key={i} className="logRow timelinePanel__row">
                  <div className="logTime timelinePanel__time">
                    {log.createdAt ? new Date(log.createdAt).toLocaleTimeString() : ""}
                  </div>
                  <div className={`logMsg ${logKind(log.level)} timelinePanel__msg`}>{label}</div>
                  {log.stepId && log.stepId !== "system" && (
                    <span className="timelinePanel__step" style={{ color: getStepColor(log.stepId) }}>[{log.stepId}]</span>
                  )}
                  {shouldShowSeparateLogError(log.message, log.error) ? (
                    <div className="timelinePanel__error">{log.error}</div>
                  ) : null}
                </div>
              );
            })}
        </div>
      </div>

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
            steps={graphSteps}
            stepStates={graphStepStates}
            loopProgressByStep={graphLoopProgressByStep}
            failureHintByStepId={graphFailureHintByStepId}
            onNodeClick={(step) => setInspectorStepId(step.id)}
          />
        </div>
      </div>

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

        <div className="logPanel" ref={logPanelRef} onScroll={handleLogPanelScroll}>
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
          {pendingLogCount > 0 && (
            <button
              type="button"
              className="logPanel__newLogsBtn"
              onClick={jumpToLatestLog}
            >
              {pendingLogCount} new log{pendingLogCount > 1 ? "s" : ""} - click to jump
            </button>
          )}
        </div>
      </div>
      </main>
    </div>
  );
}
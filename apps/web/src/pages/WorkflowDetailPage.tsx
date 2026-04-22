import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  fetchWorkflowVersions,
  rollbackWorkflow,
  fetchWorkflowDetail,
  startRun,
  fetchVersionDiff
} from "../api/workflow";
import type {
  WorkflowDetail,
  WorkflowVersionInfo,
  VersionDiffResponse
} from "../api/workflow";
import { getApiBaseUrl } from "../api/client";
import WorkflowGraph from "../components/WorkflowGraph";
import StepDetailModal from "../components/StepDetailModal";
import { parseVariables } from "../utils/variableSystem";

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [versions, setVersions] = useState<WorkflowVersionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStep, setSelectedStep] = useState<WorkflowDetail["steps"][0] | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runInputOpen, setRunInputOpen] = useState(false);
  const [runInputJson, setRunInputJson] = useState("{\n\n}");
  const [runInputError, setRunInputError] = useState("");
  const [pendingRunVersion, setPendingRunVersion] = useState<number | undefined>(undefined);
  const [diffResult, setDiffResult] = useState<VersionDiffResponse | null>(null);
  const [diffFrom, setDiffFrom] = useState<number>(1);
  const [diffTo, setDiffTo] = useState<number>(1);
  
  useEffect(() => {
  if (!id) return;

  const load = async () => {
    const detail = await fetchWorkflowDetail(id);
    setWorkflow(detail);

    const versionData = await fetchWorkflowVersions(id);
    setVersions(versionData.versions);
    setLoading(false);
  };

  load();
}, [id]);

  const handleRollback = async (version: number) => {
    if (!id) return;
    if (!confirm(`Rollback to v${version}?`)) return;
    setLoading(true)
    await rollbackWorkflow(id, version);

    // refresh workflow data
    const refetch = await fetchWorkflowDetail(id);
    if (refetch) setWorkflow(refetch);

    const versionData = await fetchWorkflowVersions(id);
    setVersions(versionData.versions);
    setLoading(false)
  };

  const collectTriggerPaths = (obj: unknown, out: Set<string>) => {
    if (obj == null) return;
    if (typeof obj === "string") {
      for (const path of parseVariables(obj)) {
        if (path.startsWith("trigger.")) out.add(path);
      }
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) collectTriggerPaths(item, out);
      return;
    }
    if (typeof obj === "object") {
      for (const value of Object.values(obj as Record<string, unknown>)) {
        collectTriggerPaths(value, out);
      }
    }
  };

  const buildInputTemplate = (triggerPaths: string[]) => {
    const root: Record<string, unknown> = {};
    for (const fullPath of triggerPaths) {
      const segments = fullPath.split(".").slice(1);
      if (segments.length === 0) continue;
      let cursor: Record<string, unknown> = root;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const isLast = i === segments.length - 1;
        if (isLast) {
          if (cursor[seg] === undefined) cursor[seg] = null;
          continue;
        }
        const next = cursor[seg];
        if (!next || typeof next !== "object" || Array.isArray(next)) {
          cursor[seg] = {};
        }
        cursor = cursor[seg] as Record<string, unknown>;
      }
    }
    return root;
  };

  const startRunWithPayload = async (workflowVersion?: number, triggerPayload?: Record<string, unknown>) => {
    if (!id) return;
    setRunLoading(true);
    try {
      const result = await startRun(id, {
        ...(workflowVersion != null ? { workflowVersion } : {}),
        ...(triggerPayload ? { triggerPayload } : {}),
      });
      navigate(`/runs/${result.runId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setRunLoading(false);
    }
  };

  const handleStartRun = async (workflowVersion?: number) => {
    if (!workflow) return;
    const triggerPaths = new Set<string>();
    for (const step of workflow.steps) {
      collectTriggerPaths(step.params ?? {}, triggerPaths);
    }
    if (triggerPaths.size === 0) {
      return startRunWithPayload(workflowVersion);
    }
    const template = buildInputTemplate(Array.from(triggerPaths).sort((a, b) => a.localeCompare(b)));
    setRunInputJson(JSON.stringify(template, null, 2));
    setRunInputError("");
    setPendingRunVersion(workflowVersion);
    setRunInputOpen(true);
  };

  const handleConfirmRunWithInput = async () => {
    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(runInputJson);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        setRunInputError("Run input must be a JSON object");
        return;
      }
      parsed = value as Record<string, unknown>;
    } catch {
      setRunInputError("Run input is not valid JSON");
      return;
    }
    setRunInputOpen(false);
    await startRunWithPayload(pendingRunVersion, parsed);
  };

  const handleShowDiff = async () => {
    if (!id || diffFrom === diffTo) return;
    try {
      const result = await fetchVersionDiff(id, diffFrom, diffTo);
      setDiffResult(result);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load diff");
    }
  };

  if (loading) return <div className="pageLayout"><div className="spinner" /></div>;

  if (!workflow) return <div className="pageLayout">Workflow not found</div>;

  return (
    <div className="pageLayout">
      {runInputOpen && (
        <div className="modalOverlay" onClick={() => setRunInputOpen(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
            <h2 style={{ marginTop: 0 }}>Run input required</h2>
            <p className="subtle" style={{ marginBottom: 10 }}>
              This workflow uses <code>trigger.*</code> variables. Provide trigger payload before starting run.
            </p>
            <textarea
              value={runInputJson}
              onChange={(e) => setRunInputJson(e.target.value)}
              rows={12}
              spellCheck={false}
              style={{
                width: "100%",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#0f172a",
                borderRadius: 8,
                padding: 10,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              }}
            />
            {runInputError ? <div className="credentialsError">{runInputError}</div> : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button type="button" onClick={() => setRunInputOpen(false)}>Cancel</button>
              <button type="button" onClick={handleConfirmRunWithInput} disabled={runLoading}>
                {runLoading ? "Starting…" : "Start run"}
              </button>
            </div>
          </div>
        </div>
      )}
      {selectedStep && (
  <StepDetailModal
    step={selectedStep}
    onClose={() => setSelectedStep(null)}
  />
)}
      <header className="pageHeader">
        <h1 className="title">{workflow.name}</h1>
        <div className="meta">
          Current Version: <strong>v{workflow.currentVersion}</strong>
          <button onClick={() => navigate(`/workflows/${id}/edit`)}>Edit</button>
          <button onClick={() => handleStartRun()} disabled={runLoading}>
            {runLoading ? "Starting…" : "Run"}
          </button>
        </div>
      </header>
      <main className="pageContent">
      <div className="cards">
        <div className="card">
          <h3>Workflow Graph</h3>
          <WorkflowGraph steps={workflow.steps} onNodeClick={(step) => {
    setSelectedStep(step);
  }}/>
        </div>
      <div className="card">
        <div className="row">
          <div className="status">
            <div><strong>Status:</strong> {workflow.enabled ? "Enabled" : "Disabled"}</div>
            <div><strong>Trigger:</strong>{" "}
              {typeof workflow.trigger === "object" && workflow.trigger !== null
                ? workflow.trigger.type === "cron"
                  ? `Cron${(workflow.trigger.cron || workflow.trigger.schedule)
                      ? ` (${workflow.trigger.cron || workflow.trigger.schedule}${workflow.trigger.timezone ? `, ${workflow.trigger.timezone}` : ""})`
                      : ""}`
                  : workflow.trigger.type === "trigger.webhook"
                    ? "Webhook"
                    : (workflow.trigger as { type?: string }).type ?? "manual"
                : String(workflow.trigger ?? "manual")}</div>
            <div><strong>Steps:</strong> {workflow.steps.length}</div>
          </div>
        </div>
      </div>

      {typeof workflow.trigger === "object" && workflow.trigger !== null && workflow.trigger.type === "trigger.webhook" && id && (
        <div className="card">
          <h3 className="card-title">Webhook URL</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input
              type="text"
              readOnly
              value={`${getApiBaseUrl()}/webhook/${id}`}
              style={{
                flex: "1 1 280px",
                minWidth: 0,
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #374151",
                background: "#0f172a",
                color: "#e5e7eb",
                fontSize: 13,
              }}
            />
            <button
              type="button"
              onClick={() => {
                const url = `${getApiBaseUrl()}/webhook/${id}`;
                navigator.clipboard.writeText(url).then(
                  () => alert("Copied to clipboard"),
                  () => alert("Copy failed")
                );
              }}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="card-title">Versions</h3>

        <div style={{ marginBottom: 12 }}>
          <label>Diff: v</label>
          <select value={diffFrom} onChange={(e) => setDiffFrom(Number(e.target.value))} style={{ marginRight: 8 }}>
            {versions.slice().sort((a, b) => a.version - b.version).map((v) => (
              <option key={v.version} value={v.version}>v{v.version}</option>
            ))}
          </select>
          <span> vs v</span>
          <select value={diffTo} onChange={(e) => setDiffTo(Number(e.target.value))} style={{ marginLeft: 4, marginRight: 8 }}>
            {versions.slice().sort((a, b) => a.version - b.version).map((v) => (
              <option key={v.version} value={v.version}>v{v.version}</option>
            ))}
          </select>
          <button onClick={handleShowDiff} disabled={diffFrom === diffTo}>Show diff</button>
          {diffResult && (
            <div style={{ marginTop: 12, padding: 8, background: "#1e293b", borderRadius: 8 }}>
              <div>Added: {diffResult.added.join(", ") || "—"}</div>
              <div>Removed: {diffResult.removed.join(", ") || "—"}</div>
              {diffResult.changed.length > 0 && (
                <div>Changed: {diffResult.changed.map((c) => `${c.stepId} (${c.changes.map((ch) => ch.field).join(", ")})`).join("; ")}</div>
              )}
              <button onClick={() => setDiffResult(null)} style={{ marginTop: 8 }}>Close</button>
            </div>
          )}
        </div>

        {versions
          .slice()
          .sort((a, b) => b.version - a.version)
          .map(v => (
            <div key={v.version} className="versionRow">
              <div>
                <strong>v{v.version}</strong>
                {v.version === workflow.currentVersion && (
                  <span style={{ marginLeft: 8, color: "#4ade80" }}>
                    (active)
                  </span>
                )}
              </div>

              <div>
                <span>Steps: {v.stepCount}</span>
                <span style={{ marginLeft: 16 }}>
                  MaxParallel: {v.maxParallel}
                </span>
              </div>

              {v.version !== workflow.currentVersion && (
                <>
                  <button
                    onClick={() => handleRollback(v.version)}
                  >
                    Rollback
                  </button>
                  <button
                    onClick={() => handleStartRun(v.version)}
                    disabled={runLoading}
                    style={{ marginLeft: 8 }}
                  >
                    Run v{v.version}
                  </button>
                </>
              )}
              {v.version === workflow.currentVersion && (
                <button onClick={() => handleStartRun(v.version)} disabled={runLoading} style={{ marginLeft: 8 }}>
                  Run v{v.version}
                </button>
              )}
            </div>
          ))}
      </div>
      </div>
      </main>
    </div>
  );
}
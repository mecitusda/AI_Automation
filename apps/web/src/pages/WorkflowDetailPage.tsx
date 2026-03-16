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
import WorkflowGraph from "../components/WorkflowGraph";
import StepDetailModal from "../components/StepDetailModal";

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [versions, setVersions] = useState<WorkflowVersionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStep, setSelectedStep] = useState<WorkflowDetail["steps"][0] | null>(null);
  const [runLoading, setRunLoading] = useState(false);
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

  const handleStartRun = async (workflowVersion?: number) => {
    if (!id) return;
    setRunLoading(true);
    try {
      const result = await startRun(id, workflowVersion != null ? { workflowVersion } : undefined);
      navigate(`/runs/${result.runId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setRunLoading(false);
    }
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

  if (loading) return <div className="spinner" />;

  if (!workflow) return <div>Workflow not found</div>;

  return (
    <div className="page">
      {selectedStep && (
  <StepDetailModal
    step={selectedStep}
    onClose={() => setSelectedStep(null)}
  />
)}
      <div className="header">
        <h1>{workflow.name}</h1>
        <div className="meta">
          Current Version: <strong>v{workflow.currentVersion}</strong>
          <button onClick={() => navigate(`/workflows/${id}/edit`)}>Edit</button>
          <button onClick={() => handleStartRun()} disabled={runLoading}>
            {runLoading ? "Starting…" : "Run"}
          </button>
        </div>
      </div>
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
            <div><strong>Trigger:</strong> {workflow.trigger}</div>
            <div><strong>Steps:</strong> {workflow.steps.length}</div>
          </div>
        </div>
      </div>

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
    </div>
  );
}
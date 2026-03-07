import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  fetchWorkflowVersions,
  rollbackWorkflow,
  fetchWorkflowDetail
} from "../api/workflow";
import type {
  WorkflowDetail,
  WorkflowVersionInfo
} from "../api/workflow";
import WorkflowGraph from "../components/WorkflowGraph";
import StepDetailModal from "../components/StepDetailModal";

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [versions, setVersions] = useState<WorkflowVersionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStep, setSelectedStep] = useState<WorkflowDetail["steps"][0] | null>(null);
  
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
    if (!confirm(`v${version}'a rollback yapılsın mı?`)) return;
    setLoading(true)
    await rollbackWorkflow(id, version);

    // refresh workflow data
    const refetch = await fetchWorkflowDetail(id);
    if (refetch) setWorkflow(refetch);

    const versionData = await fetchWorkflowVersions(id);
    setVersions(versionData.versions);
    setLoading(false)
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
                <button
                  onClick={() => handleRollback(v.version)}
                >
                  Rollback
                </button>
              )}
            </div>
          ))}
      </div>
      </div>
    </div>
  );
}
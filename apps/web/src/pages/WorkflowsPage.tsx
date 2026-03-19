import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../api/socket";
import {
  fetchWorkflows,
  fetchWorkflowVersions,
  rollbackWorkflow,
  createWorkflow,
} from "../api/workflow";
import type {
  WorkflowSummary,
  WorkflowVersionInfo
} from "../api/workflow";

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [versions, setVersions] = useState<
    Record<string, WorkflowVersionInfo[]>
  >({});
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  // initial load
  useEffect(() => {
    const load = async () => {
      const data = await fetchWorkflows();
      setWorkflows(data);
    };
    load();
  }, []);

  // 🔥 realtime workflow create listener
  useEffect(() => {
    const handleCreate = (workflow: WorkflowSummary) => {
      setWorkflows(prev => {
        if (prev.some(w => w.id === workflow.id)) {
          return prev;
        }
        return [workflow, ...prev];
      });
    };

    socket.on("workflow:create", handleCreate);

    return () => {
      socket.off("workflow:create", handleCreate);
    };
  }, []);

  const loadVersions = async (id: string) => {
    const data = await fetchWorkflowVersions(id);
    setVersions(prev => ({
      ...prev,
      [id]: data.versions
    }));
  };

  const handleRollback = async (id: string, version: number) => {
    if (!confirm(`v${version}'a rollback yapılsın mı?`)) return;
    await rollbackWorkflow(id, version);
    alert("Rollback başarılı");
    window.location.reload(); // şimdilik basit
  };

  const handleCreateWorkflow = async () => {
    const name = window.prompt("Workflow name", "Untitled");
    if (name == null) return; // cancelled
    setCreating(true);
    try {
      const w = await createWorkflow({ name: (name.trim() || "Untitled") });
      navigate(`/workflows/${w.id}/edit`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create workflow");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="pageLayout">
      <header className="pageHeader">
        <h1 className="title" style={{ margin: 0 }}>Workflows</h1>
        <button onClick={handleCreateWorkflow} disabled={creating}>
          {creating ? "Creating…" : "New workflow"}
        </button>
      </header>
      <main className="pageContent">
      <div className="cards">
      {workflows.map(w => (
        <div 
        key={w.id} 
        className="card" 
        onClick={(e) => {  e.stopPropagation();navigate(`/workflows/${w.id}`)}} 
        style={{cursor: "pointer"}}>

          <h3 className="card-title">{w.name}</h3>
          <p className="current-version">Current Version: v{w.currentVersion}</p>
          <p className="steps">Steps: {w.stepCount}</p>

          <button onClick={(e) => {e.stopPropagation(); loadVersions(w.id)}}>
            Show Versions
          </button>
          <div className="versions">
          {versions[w.id]?.map(v => (
            <div className="version">
              <div className={`version-title ${v.version === w.currentVersion ? "current" : ""}`}>v{v.version}  {v.version === w.currentVersion ? (<span className="current-title">(current)</span>): ""}</div> 
              {v.version !== w.currentVersion && (
                <button
                  onClick={(e) =>{
                    e.stopPropagation();
                    handleRollback(w.id, v.version)
                  }
                    
                  }
                >
                  Rollback
                </button>
              )}
            </div>
          ))}
          </div>
        </div>
      ))}
      </div>
      </main>
    </div>
  );
}
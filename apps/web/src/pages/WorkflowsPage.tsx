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
import { Button, Card, Modal, PageState, useToast } from "../components/ui";
import { useI18n } from "../hooks/useI18n";

export default function WorkflowsPage() {
  const { t } = useI18n();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<
    Record<string, WorkflowVersionInfo[]>
  >({});
  const [creating, setCreating] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState("Untitled");
  const [importJson, setImportJson] = useState("{\n  \n}");
  const [rollbackTarget, setRollbackTarget] = useState<{ id: string; version: number } | null>(null);
  const navigate = useNavigate();
  const { notify } = useToast();
  // initial load
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchWorkflows();
        if (!cancelled) {
          setWorkflows(data);
          setLoadError("");
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t("workflows.couldNotLoad"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
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
    await rollbackWorkflow(id, version);
      notify(`${t("workflows.rollback")} v${version}`, "success");
    setRollbackTarget(null);
    const data = await fetchWorkflows();
    setWorkflows(data);
    setVersions((prev) => ({ ...prev, [id]: [] }));
  };

  const handleCreateWorkflow = async () => {
    setCreating(true);
    try {
      const w = await createWorkflow({ name: (newWorkflowName.trim() || "Untitled") });
      notify(`${t("workflows.title")} ${t("common.create").toLowerCase()}`, "success");
      setCreateModalOpen(false);
      navigate(`/workflows/${w.id}/edit`);
    } catch (err) {
      notify(err instanceof Error ? err.message : t("workflows.couldNotLoad"), "error");
    } finally {
      setCreating(false);
    }
  };

  const handleImportWorkflow = async () => {
    setCreating(true);
    try {
      const parsed = JSON.parse(importJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Workflow JSON must be an object");
      }
      const body = parsed as {
        name?: string;
        steps?: unknown;
        maxParallel?: number;
        trigger?: unknown;
        enabled?: boolean;
      };
      if (!Array.isArray(body.steps)) throw new Error("Workflow JSON must include a steps array");
      const w = await createWorkflow({
        name: String(body.name || "Imported workflow"),
        steps: body.steps as any,
        maxParallel: body.maxParallel,
        trigger: body.trigger as any,
        enabled: body.enabled ?? false,
      });
      notify(t("workflows.import"), "success");
      setImportModalOpen(false);
      navigate(`/workflows/${w.id}/edit`);
    } catch (err) {
      notify(err instanceof Error ? err.message : t("workflows.import"), "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="pageLayout">
      <header className="pageHeader">
        <h1 className="title" style={{ margin: 0 }}>{t("workflows.title")}</h1>
        <div className="uiToolbar" style={{ marginBottom: 0 }}>
          <Button onClick={() => setImportModalOpen(true)} disabled={creating}>
            {t("workflows.importJson")}
          </Button>
          <Button variant="primary" onClick={() => setCreateModalOpen(true)} disabled={creating}>
            {t("workflows.newWorkflow")}
          </Button>
        </div>
      </header>
      <main className="pageContent">
      {loading ? <div className="spinner" /> : null}
      {!loading && loadError ? (
        <PageState title={t("workflows.couldNotLoad")} message={loadError} />
      ) : null}
      {!loading && !loadError && workflows.length === 0 ? (
        <PageState title={t("workflows.noneYet")} message={t("workflows.noneYetMessage")} />
      ) : null}
      <div className="cards">
      {workflows.map(w => (
        <Card 
        key={w.id} 
        onClick={(e) => {  e.stopPropagation();navigate(`/workflows/${w.id}`)}} 
        style={{cursor: "pointer"}}>

          <h3 className="card-title">{w.name}</h3>
          <p className="current-version">{t("workflows.currentVersion")}: v{w.currentVersion}</p>
          <p className="steps">{t("workflows.steps")}: {w.stepCount}</p>

          <Button onClick={(e) => {e.stopPropagation(); loadVersions(w.id)}}>
            {t("workflows.showVersions")}
          </Button>
          <div className="versions">
          {versions[w.id]?.map(v => (
            <div className="version" key={`${w.id}-${v.version}`}>
              <div className={`version-title ${v.version === w.currentVersion ? "current" : ""}`}>v{v.version}  {v.version === w.currentVersion ? (<span className="current-title">({t("workflows.current")})</span>): ""}</div> 
              {v.version !== w.currentVersion && (
                <Button
                  onClick={(e) =>{
                    e.stopPropagation();
                    setRollbackTarget({ id: w.id, version: v.version })
                  }
                    
                  }
                >
                  {t("workflows.rollback")}
                </Button>
              )}
            </div>
          ))}
          </div>
        </Card>
      ))}
      </div>
      </main>
      {createModalOpen ? (
        <Modal
          title={t("workflows.createWorkflow")}
          onClose={() => setCreateModalOpen(false)}
          footer={
            <>
              <Button onClick={() => setCreateModalOpen(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={handleCreateWorkflow} disabled={creating}>
                {creating ? t("workflows.creating") : t("common.create")}
              </Button>
            </>
          }
        >
          <label className="field">
            <span>{t("workflows.workflowName")}</span>
            <input
              className="uiInput"
              value={newWorkflowName}
              onChange={(event) => setNewWorkflowName(event.target.value)}
              autoFocus
            />
          </label>
        </Modal>
      ) : null}
      {rollbackTarget ? (
        <Modal
          title={t("workflows.rollbackWorkflow")}
          onClose={() => setRollbackTarget(null)}
          footer={
            <>
              <Button onClick={() => setRollbackTarget(null)}>{t("common.cancel")}</Button>
              <Button
                variant="danger"
                onClick={() => handleRollback(rollbackTarget.id, rollbackTarget.version)}
              >
                {t("workflows.rollback")}
              </Button>
            </>
          }
        >
          <p>{t("workflows.rollbackWorkflow")} v{rollbackTarget.version}?</p>
        </Modal>
      ) : null}
      {importModalOpen ? (
        <Modal
          title={t("workflows.importWorkflowJson")}
          onClose={() => setImportModalOpen(false)}
          footer={
            <>
              <Button onClick={() => setImportModalOpen(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={handleImportWorkflow} disabled={creating}>
                {creating ? t("workflows.importing") : t("workflows.import")}
              </Button>
            </>
          }
        >
          <p style={{ marginTop: 0, color: "#64748b" }}>
            {t("workflows.importHelp")}
          </p>
          <textarea
            className="uiInput"
            style={{ width: "100%", minHeight: 260, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
            value={importJson}
            onChange={(event) => setImportJson(event.target.value)}
          />
        </Modal>
      ) : null}
    </div>
  );
}
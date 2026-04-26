import { useEffect, useState } from "react";
import { fetchWorkflows } from "../api/workflow";
import type { WorkflowSummary } from "../api/workflow";
import {
  createWorkflowVariable,
  deleteWorkflowVariable,
  listWorkflowVariables,
  updateWorkflowVariable,
  type WorkflowVariableItem
} from "../api/workflowVariables";
import "../styles/DataStorePage.css";

export default function DataStorePage() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [items, setItems] = useState<WorkflowVariableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [valueJson, setValueJson] = useState("{\n  \n}");
  const [isSecret, setIsSecret] = useState(false);
  const [description, setDescription] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");

  async function loadWorkflows() {
    const data = await fetchWorkflows();
    setWorkflows(data);
    if (data.length > 0 && !workflowId) setWorkflowId(data[0].id);
  }

  async function loadItems(selectedWorkflowId: string) {
    if (!selectedWorkflowId) {
      setItems([]);
      return;
    }
    const res = await listWorkflowVariables({ workflowId: selectedWorkflowId, limit: 100 });
    setItems(res.items);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        await loadWorkflows();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load workflows");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    loadItems(workflowId).catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load records")
    );
  }, [workflowId]);

  function resetForm() {
    setEditingId(null);
    setKey("");
    setValueJson("{\n  \n}");
    setIsSecret(false);
    setDescription("");
    setTagsRaw("");
  }

  function selectItem(item: WorkflowVariableItem) {
    setEditingId(item.id);
    setKey(item.key);
    setValueJson(JSON.stringify(item.value, null, 2));
    setIsSecret(item.isSecret);
    setDescription(item.description || "");
    setTagsRaw((item.tags || []).join(","));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!workflowId || !key.trim()) {
      setError("Workflow and key are required");
      return;
    }
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(valueJson);
    } catch {
      setError("Value must be valid JSON");
      return;
    }
    const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    setSaving(true);
    try {
      if (editingId) {
        await updateWorkflowVariable(editingId, {
          value: parsedValue,
          isSecret,
          description,
          tags
        });
      } else {
        await createWorkflowVariable({
          workflowId,
          key: key.trim(),
          value: parsedValue,
          isSecret,
          description,
          tags
        });
      }
      await loadItems(workflowId);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Delete this record?")) return;
    setError("");
    try {
      await deleteWorkflowVariable(id);
      await loadItems(workflowId);
      if (editingId === id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function formatRecordPreview(item: WorkflowVariableItem): string {
    if (item.isSecret) return "[REDACTED]";
    try {
      return JSON.stringify(item.value, null, 2);
    } catch {
      return String(item.value ?? "");
    }
  }

  if (loading) return <div className="pageLayout"><div className="spinner" /></div>;

  return (
    <div className="pageLayout">
      <header className="pageHeader">
        <h1 className="title">Data Store</h1>
      </header>
      <main className="pageContent dataStorePage">
        <section className="card dataStorePage__toolbar">
          <label className="dataStorePage__label">Workflow</label>
          <select
            className="dataStorePage__select"
            value={workflowId}
            onChange={(e) => setWorkflowId(e.target.value)}
          >
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </section>
        <div className="dataStorePage__grid">
          <section className="card dataStorePage__panel">
            <h3 className="dataStorePage__panelTitle">Records</h3>
            <div className="dataStorePage__records">
              {items.length === 0 ? <p className="dataStorePage__empty">No records for this workflow yet.</p> : null}
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`dataStoreRecord${editingId === item.id ? " is-active" : ""}`}
                  onClick={() => selectItem(item)}
                >
                  <div className="dataStoreRecord__header">
                    <div className="dataStoreRecord__key">{item.key}</div>
                    <button
                      className="dataStoreRecord__delete"
                      onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                    >
                      Delete
                    </button>
                  </div>
                  <div className="dataStoreRecord__meta">
                    {item.valueType ? <span className="dataStoreRecord__badge">{item.valueType}</span> : null}
                    {item.tags?.slice(0, 3).map((tag) => (
                      <span key={`${item.id}-${tag}`} className="dataStoreRecord__tag">{tag}</span>
                    ))}
                    <span className="dataStoreRecord__time">
                      {new Date(item.updatedAt).toLocaleString("tr-TR")}
                    </span>
                  </div>
                  {item.description ? (
                    <div className="dataStoreRecord__description">{item.description}</div>
                  ) : null}
                  <div className="dataStoreRecord__value">
                    <pre>{formatRecordPreview(item)}</pre>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="card dataStorePage__panel">
            <h3 className="dataStorePage__panelTitle">{editingId ? "Edit Record" : "New Record"}</h3>
            <form className="dataStoreForm" onSubmit={onSubmit}>
              <label className="dataStorePage__label">Key</label>
              <input className="dataStorePage__input" value={key} onChange={(e) => setKey(e.target.value)} disabled={Boolean(editingId)} />
              <label className="dataStorePage__label">Value (JSON)</label>
              <textarea className="dataStorePage__textarea" value={valueJson} onChange={(e) => setValueJson(e.target.value)} rows={12} />
              <label className="dataStorePage__label">Description</label>
              <input className="dataStorePage__input" value={description} onChange={(e) => setDescription(e.target.value)} />
              <label className="dataStorePage__label">Tags (comma separated)</label>
              <input className="dataStorePage__input" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} />
              <label className="dataStorePage__checkboxRow">
                <input type="checkbox" checked={isSecret} onChange={(e) => setIsSecret(e.target.checked)} />
                Secret
              </label>
              <div className="dataStorePage__actions">
                <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
                <button type="button" onClick={resetForm}>Reset</button>
              </div>
            </form>
          </section>
        </div>
        {error ? <p className="dataStorePage__error">{error}</p> : null}
      </main>
    </div>
  );
}

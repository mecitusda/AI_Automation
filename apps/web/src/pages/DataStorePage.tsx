import { useEffect, useMemo, useState } from "react";
import { fetchWorkflows } from "../api/workflow";
import type { WorkflowSummary } from "../api/workflow";
import {
  createWorkflowVariable,
  deleteWorkflowVariable,
  listWorkflowVariableCollections,
  listWorkflowVariables,
  updateWorkflowVariable,
  type DataStoreScope,
  type DataStoreScopeFilter,
  type WorkflowVariableItem
} from "../api/workflowVariables";
import "../styles/DataStorePage.css";

const SCOPE_OPTIONS: { value: DataStoreScopeFilter; label: string }[] = [
  { value: "workflow", label: "Workflow" },
  { value: "user", label: "User" },
  { value: "all", label: "All" }
];

export default function DataStorePage() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [scopeFilter, setScopeFilter] = useState<DataStoreScopeFilter>("workflow");
  const [collectionFilter, setCollectionFilter] = useState("");
  const [collectionSuggestions, setCollectionSuggestions] = useState<string[]>([]);
  const [items, setItems] = useState<WorkflowVariableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formScope, setFormScope] = useState<DataStoreScope>("workflow");
  const [formCollection, setFormCollection] = useState("");
  const [key, setKey] = useState("");
  const [valueJson, setValueJson] = useState("{\n  \n}");
  const [isSecret, setIsSecret] = useState(false);
  const [description, setDescription] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");

  const editing = useMemo(() => items.find((it) => it.id === editingId) ?? null, [items, editingId]);

  async function loadWorkflows() {
    const data = await fetchWorkflows();
    setWorkflows(data);
    if (data.length > 0 && !workflowId) setWorkflowId(data[0].id);
  }

  async function loadItems() {
    const params: Parameters<typeof listWorkflowVariables>[0] = {
      scope: scopeFilter,
      limit: 100
    };
    if (scopeFilter !== "user") {
      if (!workflowId) {
        setItems([]);
        return;
      }
      params.workflowId = workflowId;
    }
    if (collectionFilter.trim()) {
      params.collection = collectionFilter.trim().toLowerCase();
    }
    const res = await listWorkflowVariables(params);
    setItems(res.items);
  }

  async function loadCollectionSuggestions() {
    try {
      const scope: DataStoreScope = scopeFilter === "user" ? "user" : "workflow";
      const res = await listWorkflowVariableCollections({
        scope,
        workflowId: scope === "workflow" ? workflowId : undefined
      });
      setCollectionSuggestions(res.collections.filter(Boolean));
    } catch {
      setCollectionSuggestions([]);
    }
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
    loadItems().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load records")
    );
    loadCollectionSuggestions();
  }, [workflowId, scopeFilter, collectionFilter]);

  function resetForm() {
    setEditingId(null);
    setFormScope(scopeFilter === "user" ? "user" : "workflow");
    setFormCollection(collectionFilter.trim().toLowerCase());
    setKey("");
    setValueJson("{\n  \n}");
    setIsSecret(false);
    setDescription("");
    setTagsRaw("");
  }

  function selectItem(item: WorkflowVariableItem) {
    setEditingId(item.id);
    setFormScope(item.scope);
    setFormCollection(item.collection || "");
    setKey(item.key);
    setValueJson(JSON.stringify(item.value, null, 2));
    setIsSecret(item.isSecret);
    setDescription(item.description || "");
    setTagsRaw((item.tags || []).join(","));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!key.trim()) {
      setError("Key is required");
      return;
    }
    if (formScope === "workflow" && !workflowId) {
      setError("Workflow is required for workflow-scoped records");
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
          scope: formScope,
          workflowId: formScope === "workflow" ? workflowId : undefined,
          collection: formCollection.trim().toLowerCase(),
          key: key.trim(),
          value: parsedValue,
          isSecret,
          description,
          tags
        });
      }
      await loadItems();
      await loadCollectionSuggestions();
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
      await loadItems();
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
          <div className="dataStorePage__toolbarRow">
            <div className="dataStorePage__toolbarField">
              <label className="dataStorePage__label">Scope</label>
              <div className="dataStorePage__scopeToggle">
                {SCOPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={scopeFilter === opt.value ? "is-active" : ""}
                    onClick={() => {
                      setScopeFilter(opt.value);
                      if (opt.value === "user") {
                        setFormScope("user");
                      } else if (opt.value === "workflow") {
                        setFormScope("workflow");
                      }
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {scopeFilter !== "user" ? (
              <div className="dataStorePage__toolbarField">
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
              </div>
            ) : null}
            <div className="dataStorePage__toolbarField">
              <label className="dataStorePage__label">Collection filter</label>
              <input
                className="dataStorePage__input"
                value={collectionFilter}
                onChange={(e) => setCollectionFilter(e.target.value)}
                placeholder="news, customers"
                list="dataStorePage__collections"
              />
              <datalist id="dataStorePage__collections">
                {collectionSuggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
        </section>
        <div className="dataStorePage__grid">
          <section className="card dataStorePage__panel">
            <h3 className="dataStorePage__panelTitle">Records</h3>
            <div className="dataStorePage__records">
              {items.length === 0 ? <p className="dataStorePage__empty">No records match the current filters.</p> : null}
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
                    <span className="dataStoreRecord__scope">{item.scope}</span>
                    {item.collection ? (
                      <span className="dataStoreRecord__collection">{item.collection}</span>
                    ) : null}
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
              <label className="dataStorePage__label">Scope</label>
              <select
                className="dataStorePage__select"
                value={formScope}
                onChange={(e) => setFormScope(e.target.value as DataStoreScope)}
                disabled={Boolean(editingId)}
              >
                <option value="workflow">Workflow</option>
                <option value="user">User (shared across workflows)</option>
              </select>
              <label className="dataStorePage__label">Collection</label>
              <input
                className="dataStorePage__input"
                value={formCollection}
                onChange={(e) => setFormCollection(e.target.value)}
                placeholder="news, customers"
                disabled={Boolean(editingId)}
                list="dataStorePage__collections"
              />
              <label className="dataStorePage__label">Key</label>
              <input className="dataStorePage__input" value={key} onChange={(e) => setKey(e.target.value)} disabled={Boolean(editingId)} />
              {editing ? (
                <p className="dataStorePage__empty">
                  Editing {editing.scope}-scoped record
                  {editing.collection ? ` in collection “${editing.collection}”` : ""}.
                </p>
              ) : null}
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

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  createCredential,
  deleteCredential,
  fetchCredentialById,
  fetchCredentials,
  updateCredential,
  type CredentialMeta,
} from "../api/credentials";
import { fetchPlugins } from "../api/plugins";
import "../styles/CredentialsPage.css";

type PluginWithCredential = {
  type: string;
  label: string;
  credentialTypes: string[];
};

const TELEGRAM_CREDENTIAL_TYPE = "telegram.bot";

function defaultDataTemplateForType(credentialType: string) {
  if (credentialType === TELEGRAM_CREDENTIAL_TYPE) {
    return '{\n  "botToken": ""\n}';
  }
  return "{\n  \n}";
}

function normalizeCredentialData(credentialType: string, data: Record<string, unknown>) {
  if (credentialType !== TELEGRAM_CREDENTIAL_TYPE) return data;
  const botToken = typeof data.botToken === "string" ? data.botToken : "";
  const legacyToken = typeof data.token === "string" ? data.token : "";
  if (!botToken && legacyToken) {
    return { ...data, botToken: legacyToken };
  }
  return data;
}

export default function CredentialsPage() {
  const [plugins, setPlugins] = useState<PluginWithCredential[]>([]);
  const [selectedPluginType, setSelectedPluginType] = useState("");
  const [selectedCredentialType, setSelectedCredentialType] = useState("");

  const [rows, setRows] = useState<CredentialMeta[]>([]);
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [dataJson, setDataJson] = useState(defaultDataTemplateForType(""));
  const [error, setError] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const pluginDefs = await fetchPlugins();
      const nextPlugins: PluginWithCredential[] = [];
      for (const plugin of pluginDefs) {
        const credentialTypes = Array.from(
          new Set((plugin.credentials || []).map((c) => c?.type).filter(Boolean))
        ) as string[];
        if (credentialTypes.length > 0) {
          nextPlugins.push({
            type: plugin.type,
            label: plugin.label || plugin.type,
            credentialTypes,
          });
        }
      }
      nextPlugins.sort((a, b) => a.label.localeCompare(b.label));
      setPlugins(nextPlugins);

      if (nextPlugins.length > 0 && !selectedPluginType) {
        setSelectedPluginType(nextPlugins[0].type);
        setSelectedCredentialType(nextPlugins[0].credentialTypes[0]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e?.message || "Failed to load credentials"));
  }, []);

  useEffect(() => {
    const selected = plugins.find((p) => p.type === selectedPluginType);
    if (!selected) return;
    if (!selected.credentialTypes.includes(selectedCredentialType)) {
      setSelectedCredentialType(selected.credentialTypes[0]);
    }
  }, [plugins, selectedPluginType, selectedCredentialType]);

  async function loadRowsByType(nextType: string) {
    const credentials = await fetchCredentials({ type: nextType });
    setRows(credentials);
    setSelectedCredentialId(null);
  }

  useEffect(() => {
    if (!selectedCredentialType) return;
    loadRowsByType(selectedCredentialType).catch((e) =>
      setError(e?.message || "Failed to load credentials")
    );
  }, [selectedCredentialType]);

  const selectedPlugin = useMemo(
    () => plugins.find((p) => p.type === selectedPluginType) || null,
    [plugins, selectedPluginType]
  );

  const isEditMode = Boolean(selectedCredentialId);

  const resetFormForType = (nextType?: string) => {
    const resolvedType = nextType || selectedCredentialType || "";
    setSelectedCredentialId(null);
    setName("");
    setType(resolvedType);
    setDataJson(defaultDataTemplateForType(resolvedType));
  };

  useEffect(() => {
    resetFormForType(selectedCredentialType);
  }, [selectedCredentialType]);

  const onSelectPlugin = (pluginType: string) => {
    const plugin = plugins.find((p) => p.type === pluginType);
    if (!plugin) return;
    setSelectedPluginType(pluginType);
    setSelectedCredentialType(plugin.credentialTypes[0] || "");
    setError("");
  };

  const onSelectCredential = async (id: string) => {
    setError("");
    try {
      const detail = await fetchCredentialById(id);
      const normalizedData = normalizeCredentialData(detail.type, detail.data || {});
      setSelectedCredentialId(detail.id);
      setName(detail.name);
      setType(detail.type);
      setDataJson(JSON.stringify(normalizedData, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load credential detail");
    }
  };

  const parseDataJson = (): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(dataJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Credential data must be a JSON object");
        return null;
      }
    return normalizeCredentialData(type.trim(), parsed as Record<string, unknown>);
    } catch {
      setError("Credential data is not valid JSON");
      return null;
    }
  };

  const handleCreateOrUpdate = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmedName = name.trim();
    const trimmedType = type.trim();
    if (!trimmedName || !trimmedType) {
      setError("Name and type are required");
      return;
    }

    const parsedData = parseDataJson();
    if (!parsedData) return;

    if (isEditMode && selectedCredentialId) {
      setUpdating(true);
      try {
        await updateCredential(selectedCredentialId, {
          name: trimmedName,
          type: trimmedType,
          data: parsedData,
        });
        await loadRowsByType(selectedCredentialType);
        resetFormForType(selectedCredentialType);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update credential");
      } finally {
        setUpdating(false);
      }
      return;
    }

    setSaving(true);
    try {
      await createCredential({
        name: trimmedName,
        type: trimmedType,
        data: parsedData,
      });
      await loadRowsByType(selectedCredentialType || trimmedType);
      resetFormForType(selectedCredentialType || trimmedType);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create credential");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this credential?")) return;
    setRemovingId(id);
    setError("");
    try {
      await deleteCredential(id);
      await loadRowsByType(selectedCredentialType);
      if (selectedCredentialId === id) resetFormForType(selectedCredentialType);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete credential");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="pageLayout">
      <header className="pageHeader">
        <h1 className="title">Credentials</h1>
      </header>

      <main className="pageContent credentialsPage">
        <section className="card credentialsPluginList">
          <h3 className="card-title">Plugins</h3>
          <div className="credentialsTable">
            {plugins.length === 0 ? (
              <div className="subtle">No credential-enabled plugins found.</div>
            ) : (
              plugins.map((plugin) => (
                <button
                  key={plugin.type}
                  type="button"
                  className={`credentialsPluginItem${plugin.type === selectedPluginType ? " is-active" : ""}`}
                  onClick={() => onSelectPlugin(plugin.type)}
                >
                  <span className="credentialsPluginItem__name">{plugin.label}</span>
                  <span className="credentialsPluginItem__meta">{plugin.type}</span>
                  <span className="credentialsPluginItem__chips">
                    {plugin.credentialTypes.map((t) => (
                      <span key={t} className="credentialsHints__chip">{t}</span>
                    ))}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="card credentialsCard">
          <h3 className="card-title">{selectedPlugin ? `${selectedPlugin.label} credentials` : "Credentials"}</h3>

          {selectedPlugin?.credentialTypes.length ? (
            <div className="credentialsHints">
              <div className="credentialsHints__title">Credential type</div>
              <div className="credentialsHints__list">
                {selectedPlugin.credentialTypes.map((t) => (
                  <button
                    type="button"
                    key={t}
                    className={`credentialsHints__chip${selectedCredentialType === t ? " is-active" : ""}`}
                    onClick={() => setSelectedCredentialType(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="subtle">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="subtle">No credentials yet.</div>
          ) : (
            <div className="credentialsTable">
              {rows.map((row) => (
                <div className={`credentialsRow${row.id === selectedCredentialId ? " is-selected" : ""}`} key={row.id}>
                  <div>
                    <div className="credentialsRow__name">{row.name}</div>
                    <div className="credentialsRow__meta">{row.type}</div>
                  </div>
                  <div className="credentialsRow__actions">
                    <button type="button" onClick={() => onSelectCredential(row.id)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => handleDelete(row.id)} disabled={removingId === row.id}>
                      {removingId === row.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="credentialsFormWrap">
            <h3 className="card-title">{isEditMode ? "Edit credential" : "Create credential"}</h3>
            <form className="credentialsForm" onSubmit={handleCreateOrUpdate}>
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Telegram Bot" />
              </label>

              <label>
                Type
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  disabled={!selectedPlugin || selectedPlugin.credentialTypes.length === 0}
                >
                  {(selectedPlugin?.credentialTypes || [type]).filter(Boolean).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Data (JSON object)
                <textarea
                  value={dataJson}
                  onChange={(e) => setDataJson(e.target.value)}
                  rows={8}
                  spellCheck={false}
                />
              </label>

              <div className="credentialsActions">
                <button type="submit" disabled={saving || updating}>
                  {isEditMode ? (updating ? "Updating..." : "Update credential") : (saving ? "Saving..." : "Save credential")}
                </button>
                {isEditMode ? (
                  <button type="button" onClick={() => resetFormForType(selectedCredentialType)}>
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </form>
          </div>

          {error ? <div className="credentialsError">{error}</div> : null}
        </section>
      </main>
    </div>
  );
}

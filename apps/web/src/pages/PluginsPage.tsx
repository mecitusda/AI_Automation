import { useEffect, useMemo, useState } from "react";
import { fetchPlugins, type PluginInfo } from "../api/plugins";
import { Button, Card, PageState } from "../components/ui";
import { getPluginIcon } from "../utils/pluginIcons";
import { useI18n } from "../hooks/useI18n";

export default function PluginsPage() {
  const { t } = useI18n();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setPlugins(await fetchPlugins());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("plugins.couldNotLoad"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(plugins.map((plugin) => plugin.category || "utilities"))).sort()],
    [plugins]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return plugins
      .filter((plugin) => category === "all" || plugin.category === category)
      .filter((plugin) => {
        if (!q) return true;
        return [plugin.type, plugin.label, plugin.category].some((value) =>
          String(value || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => `${a.category}:${a.label}`.localeCompare(`${b.category}:${b.label}`));
  }, [plugins, query, category]);

  const roadmap = [
    "Google Sheets read/write/append",
    "Notion and Airtable CRUD",
    "PostgreSQL/MySQL query",
    "Webhook Response node",
    "Wait/Approval node",
    "Execute Workflow (sub-workflow)",
    "S3/R2 file upload/download",
    "RSS feed trigger/read"
  ];

  return (
    <div className="pageLayout">
      <header className="pageHeader">
        <div>
          <h1 className="title">{t("plugins.title")}</h1>
          <p className="subtle">{t("plugins.subtitle")}</p>
        </div>
        <Button onClick={load} disabled={loading}>{t("common.refresh")}</Button>
      </header>

      <main className="pageContent">
        <div className="uiToolbar">
          <input
            className="uiInput"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("common.searchPlugins")}
          />
          <select className="uiInput" value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => (
              <option key={item} value={item}>{item === "all" ? t("common.allCategories") : item}</option>
            ))}
          </select>
        </div>

        {loading ? <div className="spinner" /> : null}
        {!loading && error ? (
          <PageState title={t("plugins.couldNotLoad")} message={error} action={<Button onClick={load}>{t("common.retry")}</Button>} />
        ) : null}
        {!loading && !error && filtered.length === 0 ? (
          <PageState title={t("plugins.noPlugins")} message={t("plugins.noPluginsMessage")} />
        ) : null}

        {!loading && !error && filtered.length > 0 ? (
          <>
            <div className="uiGrid">
              {filtered.map((plugin) => (
                <Card key={plugin.type} className="pluginCard">
                  <div className="pluginCard__header">
                    <div className="pluginCard__titleWrap">
                      <img className="pluginCard__icon" src={getPluginIcon(plugin.type, plugin.category)} alt="" />
                      <div>
                      <h3>{plugin.label}</h3>
                      <p>{plugin.type}</p>
                      </div>
                    </div>
                    <span className="badge">{plugin.trigger ? t("plugins.trigger") : plugin.category}</span>
                  </div>
                  <div className="pluginCard__meta">
                    <span>{plugin.schema?.length ?? 0} fields</span>
                    <span>{plugin.credentials?.length ? t("plugins.credentialRequired") : t("plugins.noCredential")}</span>
                    <span>{plugin.output ? t("plugins.typedOutput") : t("plugins.genericOutput")}</span>
                  </div>
                  {plugin.credentials?.length ? (
                    <p className="pluginCard__detail">
                      {t("plugins.credentials")}: {plugin.credentials.map((cred) => cred.type).join(", ")}
                    </p>
                  ) : null}
                </Card>
              ))}
            </div>

            <Card style={{ marginTop: 18 }}>
              <h3>{t("plugins.recommendedNextIntegrations")}</h3>
              <p className="subtle">{t("plugins.roadmapSubtitle")}</p>
              <div className="pluginCard__meta" style={{ marginTop: 12 }}>
                {roadmap.map((item) => <span key={item}>{item}</span>)}
              </div>
            </Card>
          </>
        ) : null}
      </main>
    </div>
  );
}

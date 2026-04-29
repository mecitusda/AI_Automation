import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPlugins, type PluginInfo } from "../api/plugins";
import { getApiBaseUrl } from "../api/client";
import { Button, PageState } from "../components/ui";
import { getPluginIcon } from "../utils/pluginIcons";
import { useI18n } from "../hooks/useI18n";
import "../styles/MarketingPages.css";

type PluginTab = "overview" | "inputs" | "outputs" | "credentials" | "api";
type DocsView = "introduction" | "concepts" | "plugins" | string;

const docsNav = [
  {
    title: "docs.nav.start",
    links: [
      ["introduction", "docs.nav.introduction"],
      ["quickstart", "docs.nav.quickstart"],
      ["concepts", "docs.nav.coreConcepts"],
    ],
  },
  {
    title: "docs.nav.build",
    links: [
      ["workflow-builder", "docs.nav.workflowBuilder"],
      ["triggers", "docs.nav.triggers"],
      ["control-flow", "docs.nav.controlFlow"],
      ["variables", "docs.nav.variables"],
    ],
  },
  {
    title: "docs.nav.integrations",
    links: [
      ["plugins", "docs.nav.plugins"],
      ["credentials", "docs.nav.credentials"],
      ["datastore", "docs.nav.dataStore"],
      ["webhooks", "docs.nav.webhooks"],
    ],
  },
  {
    title: "docs.nav.operations",
    links: [
      ["runs", "docs.nav.runs"],
      ["debugging", "docs.nav.debugging"],
      ["replay", "docs.nav.replay"],
      ["monitoring", "docs.nav.monitoring"],
    ],
  },
  {
    title: "docs.nav.reference",
    links: [
      ["api-surface", "docs.nav.apiSurface"],
      ["environment", "docs.nav.environment"],
      ["security", "docs.nav.security"],
    ],
  },
] as const;

const lifecycle = [
  ["Receive", "Accept manual, cron, webhook, and Telegram trigger events."],
  ["Decide", "Branch with IF, switch, dependency modes, and error outputs."],
  ["Act", "Call APIs, AI models, Slack, Telegram, email, code, and transform nodes."],
  ["Persist", "Store workflow-scoped state with db.set, db.get, db.query, and db.delete."],
  ["Observe", "Inspect graph, timeline, logs, resolved inputs, outputs, and replay results."],
];

const guideCards = [
  {
    title: "Launch a workflow",
    text: "Create from a template or blank canvas, wire nodes, then run it with real trigger payloads.",
    icon: getPluginIcon("template"),
    view: "quickstart",
  },
  {
    title: "Explore plugins",
    text: "Open the live plugin reference and inspect input schemas, outputs, credentials, and API metadata.",
    icon: getPluginIcon("flow"),
    view: "plugins",
  },
  {
    title: "Secure integrations",
    text: "Use encrypted credentials, webhook secrets, CORS configuration, and safe code execution controls.",
    icon: getPluginIcon("task"),
    view: "security",
  },
  {
    title: "Debug the runtime",
    text: "Use run graph, timeline, logs, resolved input snapshots, outputs, and replay to explain every run.",
    icon: getPluginIcon("webhook.response"),
    view: "debugging",
  },
];

const contentSections = [
  {
    id: "quickstart",
    eyebrow: "Start",
    title: "Quickstart: ship a flow in four passes",
    body: "Start small, test early, and then harden the workflow with credentials, datastore state, error branches, and observability.",
    bullets: [
      "Install a template or create a blank workflow.",
      "Add nodes from the command palette and connect handles.",
      "Attach credentials and run with a trigger payload.",
      "Open Run Detail to inspect timeline, graph, outputs, and resolved inputs.",
    ],
    code: "Create workflow -> Add trigger -> Add action -> Test run -> Inspect detail",
    link: ["/templates", "Browse templates"],
  },
  {
    id: "workflow-builder",
    eyebrow: "Build",
    title: "Workflow Builder",
    body: "The editor is a graph canvas for orchestrating triggers, actions, branches, retries, and loop-aware dependencies.",
    bullets: [
      "Use Ctrl/Cmd + K to open the node command palette.",
      "Drag from a node handle into empty space to add and connect a new node.",
      "Use dependency modes for foreach barriers and per-iteration execution.",
      "Duplicate, disable, and delete nodes from node toolbar or context menu.",
    ],
    code: "trigger.webhook -> foreach -> if -> slack\n                 -> db.set -> webhook.response",
    link: ["/workflows", "Open workflows"],
  },
  {
    id: "triggers",
    eyebrow: "Build",
    title: "Triggers",
    body: "Triggers create run records and normalize incoming payloads before the orchestrator starts executing steps.",
    bullets: [
      "Manual runs are started from workflow detail or editor test run.",
      "Cron triggers are scheduled when enabled workflows are registered.",
      "Webhook triggers expose /webhook/:workflowId and support secrets/signatures.",
      "Telegram triggers normalize inbound update payloads for bot workflows.",
    ],
    code: "POST /webhook/:workflowId\nHeader: x-webhook-secret: <secret>\nBody: { \"email\": \"user@example.com\" }",
  },
  {
    id: "control-flow",
    eyebrow: "Build",
    title: "Control Flow",
    body: "Control nodes decide how downstream steps execute. They are especially important for loops, fallbacks, and failure paths.",
    bullets: [
      "IF routes true and false handles.",
      "Foreach expands item arrays and stores loop context.",
      "Switch, parallel, and merge nodes model wider branching patterns.",
      "Error outputs and errorFrom steps keep failure handling explicit.",
    ],
    code: "IF true -> continue\nIF false -> fallback\nerror output -> notify / compensate",
  },
  {
    id: "variables",
    eyebrow: "Build",
    title: "Variables",
    body: "String fields can reference runtime data with double-brace expressions. Run Detail captures resolved parameters with secrets redacted.",
    bullets: [
      "Use trigger.body and trigger.query for webhook payloads.",
      "Use previous step outputs by step id.",
      "Use loops.<loopStepId> for nested loop context.",
      "Use the editor variable helpers to avoid brittle paths.",
    ],
    code: "{{ trigger.body.email }}\n{{ trigger.query.source }}\n{{ steps.fetchUser.output.name }}\n{{ loops.loop_0.item.id }}",
  },
  {
    id: "credentials",
    eyebrow: "Integrations",
    title: "Credentials",
    body: "Credentials are encrypted server-side and selected by credential-aware plugin forms. Supported credentials can be tested before use.",
    bullets: [
      "Telegram bot credentials use botToken.",
      "OpenAI credentials use apiKey and optional baseUrl.",
      "Slack credentials use a bot token.",
      "Raw credential data is not returned in list responses.",
    ],
    code: "{\n  \"name\": \"Production Telegram Bot\",\n  \"type\": \"telegram.bot\",\n  \"data\": { \"botToken\": \"...\" }\n}",
    link: ["/credentials", "Manage credentials"],
  },
  {
    id: "datastore",
    eyebrow: "Integrations",
    title: "Data Store",
    body: "Data Store nodes provide workflow-scoped persistence for small structured values without adding a dedicated external database.",
    bullets: [
      "db.set writes a key/value record.",
      "db.get reads one key.",
      "db.query lists keys by prefix with a limit.",
      "db.delete removes a key from the workflow store.",
    ],
    code: "db.set key=user:42 value={{ steps.fetch.output }}\ndb.get key=user:42\ndb.query keyPrefix=user:",
    link: ["/data-store", "Open Data Store"],
  },
  {
    id: "webhooks",
    eyebrow: "Integrations",
    title: "Webhooks",
    body: "Webhook workflows can either queue asynchronously or return a synchronous response from a Webhook Response node.",
    bullets: [
      "Incoming body is available at trigger.body and trigger.payload.",
      "Query params are available at trigger.query.",
      "Webhook secrets can reject unknown callers.",
      "webhook.response waits for response output before replying to the caller.",
    ],
    code: "Default: 202 { \"message\": \"Run queued\" }\nWith webhook.response: custom status, headers, and body",
  },
  {
    id: "runs",
    eyebrow: "Operations",
    title: "Runs",
    body: "Runs are execution records. The list page stays high-level, while detail pages show step-level evidence.",
    bullets: [
      "Filter runs by status.",
      "Open a run to inspect graph and timeline.",
      "Use run summary chips for aggregate state, not thousands of step rows.",
      "Cancel running or retrying runs when needed.",
    ],
    code: "Run -> stepStates -> outputs -> logs -> timeline",
    link: ["/runs", "Open runs"],
  },
  {
    id: "debugging",
    eyebrow: "Operations",
    title: "Debugging",
    body: "Run Detail explains the execution with multiple synchronized views.",
    bullets: [
      "Graph colors show current step status.",
      "Timeline orders run and step events.",
      "Inspector shows resolved inputs, dependency outputs, final output, and logs.",
      "Failure reason is promoted near the run header.",
    ],
    code: "Open run -> click graph node -> inspect resolved input / output / errors",
  },
  {
    id: "replay",
    eyebrow: "Operations",
    title: "Replay",
    body: "Replay starts a new run from a selected step using the saved workflow snapshot and available context.",
    bullets: [
      "Select a step in a completed or failed run.",
      "Start replay from that point.",
      "Compare replay output and logs with the original run.",
    ],
    code: "POST /runs/:id/replay\n{ \"fromStepId\": \"step_2\" }",
  },
  {
    id: "monitoring",
    eyebrow: "Operations",
    title: "Monitoring",
    body: "Admin monitoring pages expose system health, queue depth, stuck runs, and slow API route summaries.",
    bullets: [
      "System page is admin-only.",
      "Metrics page summarizes recent run and log activity.",
      "Stuck runs can be reviewed and healed from system tooling.",
    ],
    code: "Admin -> System -> queue length / stuck runs / API performance",
  },
  {
    id: "api-surface",
    eyebrow: "Reference",
    title: "API Surface",
    body: "The UI talks to the API with typed client modules. Plugin metadata is public, while workflow and run resources require auth.",
    bullets: [
      "GET /plugins lists plugin metadata.",
      "GET /plugins/:type returns one plugin definition.",
      "GET /runs and /runs/:id/detail require auth.",
      "POST /webhook/:workflowId triggers webhook workflows.",
    ],
    code: "GET /plugins\nGET /plugins/http\nGET /runs?format=page&limit=50\nPOST /webhook/:workflowId",
  },
  {
    id: "environment",
    eyebrow: "Reference",
    title: "Environment",
    body: "Runtime configuration controls API URLs, CORS, auth secrets, worker limits, OpenAI defaults, SMTP, and code execution.",
    bullets: [
      "VITE_API_URL points the web app to the API.",
      "CORS_ORIGIN controls allowed frontend origins.",
      "CODE_PLUGIN_ENABLED=false disables code plugin execution.",
      "GLOBAL_MAX_INFLIGHT and worker settings tune execution capacity.",
    ],
    code: "VITE_API_URL=http://localhost:4000\nCORS_ORIGIN=http://localhost:5173\nCODE_PLUGIN_ENABLED=false",
  },
  {
    id: "security",
    eyebrow: "Reference",
    title: "Security",
    body: "The platform separates auth, credential storage, webhook access, and plugin execution safety.",
    bullets: [
      "Access tokens are refreshed with rotated refresh tokens.",
      "Credential data is encrypted before storage.",
      "Webhook secrets and signatures protect inbound triggers.",
      "Production can disable code plugin execution.",
    ],
    code: "JWT access + refresh rotation\nEncrypted credentials\nWebhook secret/signature\nCODE_PLUGIN_ENABLED=false",
  },
];

function prettyJson(value: unknown) {
  if (value == null) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getCategory(plugin: PluginInfo) {
  return plugin.trigger ? "triggers" : plugin.category || "utilities";
}

export default function DocsPage() {
  const { t } = useI18n();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState<DocsView>("introduction");
  const [pluginQuery, setPluginQuery] = useState("");
  const [pluginCategory, setPluginCategory] = useState("all");
  const [selectedPluginType, setSelectedPluginType] = useState("");
  const [activePluginTab, setActivePluginTab] = useState<PluginTab>("overview");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPlugins()
      .then((items) => {
        if (!cancelled) {
          setPlugins(items);
          setError("");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("plugins.couldNotLoad"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pluginCategories = useMemo(
    () => ["all", ...Array.from(new Set(plugins.map(getCategory))).sort()],
    [plugins]
  );

  const filteredPlugins = useMemo(() => {
    const q = pluginQuery.trim().toLowerCase();
    return plugins
      .filter((plugin) => {
        const category = getCategory(plugin);
        return pluginCategory === "all" || category === pluginCategory;
      })
      .filter((plugin) => {
        if (!q) return true;
        return [plugin.type, plugin.label, plugin.category].some((value) => String(value || "").toLowerCase().includes(q));
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [plugins, pluginCategory, pluginQuery]);

  const selectedPlugin = useMemo(() => {
    return plugins.find((plugin) => plugin.type === selectedPluginType) ?? filteredPlugins[0] ?? plugins[0] ?? null;
  }, [plugins, filteredPlugins, selectedPluginType]);

  useEffect(() => {
    if (activeView !== "plugins") return;
    if (selectedPluginType && selectedPlugin && !filteredPlugins.some((plugin) => plugin.type === selectedPlugin.type)) {
      setSelectedPluginType(filteredPlugins[0]?.type || plugins[0]?.type || "");
    }
  }, [activeView, filteredPlugins, plugins, selectedPlugin, selectedPluginType]);

  const samplePluginResponse = selectedPlugin
    ? {
        type: selectedPlugin.type,
        label: selectedPlugin.label,
        category: selectedPlugin.category,
        schema: selectedPlugin.schema ?? [],
        output: selectedPlugin.output ?? null,
        credentials: selectedPlugin.credentials ?? [],
        trigger: selectedPlugin.trigger === true,
      }
    : {};
  const apiBaseUrl = getApiBaseUrl() || window.location.origin;
  const activeSection = contentSections.find((section) => section.id === activeView);
  const isPluginDetail = activeView === "plugins" && Boolean(selectedPluginType && selectedPlugin);

  const openDoc = (view: DocsView) => {
    setActiveView(view);
    if (view !== "plugins") {
      setSelectedPluginType("");
      setActivePluginTab("overview");
    }
  };

  const renderIntro = () => (
    <>
      <section className="docsIntro">
        <span>AI Automation Docs</span>
        <h1>Docs that behave like a product manual, not a landing page</h1>
        <p>Pick a topic from the left. The main panel renders only that guide, keeping long reference content focused and readable.</p>
      </section>

        <section className="docsGuideCards" aria-label={t("nav.docs")}>
        {guideCards.map((card) => (
          <button key={card.title} type="button" className="docsGuideCard" onClick={() => openDoc(card.view)}>
            <img src={card.icon} alt="" />
            <h2>{card.title}</h2>
            <p>{card.text}</p>
          </button>
        ))}
      </section>
    </>
  );

  const renderConcepts = () => (
    <section className="docsProductSection docsLifecycleSection">
      <span className="docsSectionEyebrow">Start</span>
      <h2>Automation lifecycle</h2>
      <p>AI Automation docs are organized around the runtime path your workflows follow.</p>
      <div className="docsLifecycleGrid">
        {lifecycle.map(([title, text]) => (
          <div key={title} className="docsLifecycleCard">
            <span>{title.slice(0, 1)}</span>
            <strong>{title}</strong>
            <p>{text}</p>
          </div>
        ))}
      </div>
    </section>
  );

  const renderArticle = () => {
    if (!activeSection) return null;
    return (
      <section className="docsProductSection docsArticleSection">
        <span className="docsSectionEyebrow">{activeSection.eyebrow}</span>
        <h2>{activeSection.title}</h2>
        <p>{activeSection.body}</p>
        <div className="docsArticleGrid">
          <ul className="docsChecklist">
            {activeSection.bullets.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <pre className="docCode">{activeSection.code}</pre>
        </div>
        {activeSection.link ? (
          <Link className="docsInlineLink" to={activeSection.link[0]}>{activeSection.link[1]}</Link>
        ) : null}
      </section>
    );
  };

  const renderPluginList = () => (
    <section className="docsProductSection docsPluginReference">
      <span className="docsSectionEyebrow">Integrations</span>
        <h2>{t("plugins.title")}</h2>
      <p>Search the live plugin catalog. Click any plugin to open a focused reference page for that plugin only.</p>
      {loading ? <div className="docsLoading">Loading plugins...</div> : null}
      {!loading && error ? (
        <PageState title={t("plugins.couldNotLoad")} message={error} action={<Button onClick={() => window.location.reload()}>{t("common.retry")}</Button>} />
      ) : null}
      {!loading && !error ? (
        <div className="docsPluginCatalog">
          <div className="docsPluginCatalog__toolbar">
            <input
              value={pluginQuery}
              onChange={(event) => setPluginQuery(event.target.value)}
              placeholder={t("common.searchPlugins")}
            />
            <select value={pluginCategory} onChange={(event) => setPluginCategory(event.target.value)}>
              {pluginCategories.map((category) => (
                <option key={category} value={category}>{category === "all" ? t("common.allCategories") : category}</option>
              ))}
            </select>
          </div>
          <div className="docsPluginCatalog__grid">
            {filteredPlugins.map((plugin) => (
              <button
                key={plugin.type}
                type="button"
                className="docsPluginCatalogCard"
                onClick={() => {
                  setSelectedPluginType(plugin.type);
                  setActivePluginTab("overview");
                }}
              >
                <img src={getPluginIcon(plugin.type, plugin.category)} alt="" />
                <span>
                  <strong>{plugin.label}</strong>
                  <small>{plugin.type}</small>
                </span>
                <em>{getCategory(plugin)}</em>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );

  const renderPluginDetail = () => {
    if (!selectedPlugin) return renderPluginList();

    return (
      <section className="docsProductSection docsPluginDetailPage">


        <button onClick={() => setSelectedPluginType("")} type="button" className="docsBackButton">
        <svg height="16" width="16" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 1024 1024"><path d="M874.690416 495.52477c0 11.2973-9.168824 20.466124-20.466124 20.466124l-604.773963 0 188.083679 188.083679c7.992021 7.992021 7.992021 20.947078 0 28.939099-4.001127 3.990894-9.240455 5.996574-14.46955 5.996574-5.239328 0-10.478655-1.995447-14.479783-5.996574l-223.00912-223.00912c-3.837398-3.837398-5.996574-9.046027-5.996574-14.46955 0-5.433756 2.159176-10.632151 5.996574-14.46955l223.019353-223.029586c7.992021-7.992021 20.957311-7.992021 28.949332 0 7.992021 8.002254 7.992021 20.957311 0 28.949332l-188.073446 188.073446 604.753497 0C865.521592 475.058646 874.690416 484.217237 874.690416 495.52477z"></path></svg>
         <span>{t("docs.backToPlugins")}</span>
        </button>



        <header className="docsPluginDetailHeader docsPluginDetailHeader--large">
          <img src={getPluginIcon(selectedPlugin.type, selectedPlugin.category)} alt="" />
          <div>
            <span className="docsSectionEyebrow">{t("docs.pluginReference")}</span>
            <h2>{selectedPlugin.label}</h2>
            <p>{selectedPlugin.type} · {selectedPlugin.trigger ? "trigger" : selectedPlugin.category}</p>
          </div>
        </header>

        <div className="docsPluginTabs" role="tablist" aria-label="Plugin details">
          {(["overview", "inputs", "outputs", "credentials", "api"] as PluginTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className={activePluginTab === tab ? "is-active" : ""}
              onClick={() => setActivePluginTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {activePluginTab === "overview" ? (
          <div className="docsPluginTabPanel">
            <div className="docsMetricGrid">
                      <div><span>{t("docs.category")}</span><strong>{getCategory(selectedPlugin)}</strong></div>
                      <div><span>{t("docs.inputs")}</span><strong>{selectedPlugin.handles?.inputs?.length ?? 1}</strong></div>
                      <div><span>{t("docs.outputs")}</span><strong>{selectedPlugin.handles?.outputs?.length ?? 1}</strong></div>
                      <div><span>{t("docs.errorOutput")}</span><strong>{selectedPlugin.handles?.errorOutput ? t("docs.yes") : t("docs.default")}</strong></div>
            </div>
            {selectedPlugin.summaryTemplate ? (
              <div className="docsMiniBlock">
                        <span>{t("docs.summaryTemplate")}</span>
                <code>{selectedPlugin.summaryTemplate}</code>
              </div>
            ) : null}
          </div>
        ) : null}

        {activePluginTab === "inputs" ? (
          <div className="docsPluginTabPanel">
            {(selectedPlugin.schema ?? []).length > 0 ? (
              <div className="docsSchemaTable">
                {(selectedPlugin.schema ?? []).map((field) => (
                  <div key={field.key} className="docsSchemaRow">
                    <strong>{field.key}</strong>
                    <span>{field.type}</span>
                    <p>{field.label}{field.required ? " · required" : ""}</p>
                    {field.default !== undefined ? <code>default: {String(field.default)}</code> : null}
                    {field.options?.length ? <small>options: {field.options.map((opt) => opt.label || opt.value).join(", ")}</small> : null}
                  </div>
                ))}
              </div>
                    ) : <p className="docsEmptyText">{t("docs.noDeclaredInputs")}</p>}
          </div>
        ) : null}

        {activePluginTab === "outputs" ? (
          <div className="docsPluginTabPanel">
            <div className="docsMiniBlock">
                      <span>{t("docs.outputSchema")}</span>
              <pre className="docCode docCode--compact">{prettyJson(selectedPlugin.output ?? { type: "generic" })}</pre>
            </div>
          </div>
        ) : null}

        {activePluginTab === "credentials" ? (
          <div className="docsPluginTabPanel">
            {(selectedPlugin.credentials ?? []).length > 0 ? (
              <div className="docsCredentialList">
                {(selectedPlugin.credentials ?? []).map((cred) => (
                  <div key={cred.type}>
                    <strong>{cred.type}</strong>
                    <span>{cred.required ? "required" : "optional"}</span>
                  </div>
                ))}
              </div>
                    ) : <p className="docsEmptyText">{t("docs.noCredentialRequirements")}</p>}
                    <Link className="docsInlineLink" to="/credentials">{t("docs.manageCredentials")}</Link>
          </div>
        ) : null}

        {activePluginTab === "api" ? (
          <div className="docsPluginTabPanel docsApiPanel">
            <div>
                      <h4>{t("docs.request")}</h4>
              <pre className="docCode docCode--compact">{`curl -X GET "${apiBaseUrl}/plugins/${selectedPlugin.type}" \\
  -H "accept: application/json"`}</pre>
            </div>
            <div>
                      <h4>{t("docs.response")}</h4>
              <pre className="docCode docCode--compact">{prettyJson(samplePluginResponse)}</pre>
            </div>
          </div>
        ) : null}
      </section>
    );
  };

  const renderContent = () => {
    if (activeView === "introduction") return renderIntro();
    if (activeView === "concepts") return renderConcepts();
    if (activeView === "plugins") return isPluginDetail ? renderPluginDetail() : renderPluginList();
    return renderArticle();
  };

  return (
    <div className="docsProductPage">
      <aside className="docsProductSidebar" aria-label="Documentation navigation">
        {docsNav.map((group) => (
          <div key={group.title} className="docsProductSidebar__group">
            <p>{t(group.title)}</p>
            {group.links.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={activeView === id ? "is-active" : ""}
                onClick={() => openDoc(id)}
              >
                {t(label)}
              </button>
            ))}
          </div>
        ))}
        <div className="docsProductSidebar__group">
          <p>{t("docs.appLinks")}</p>
          <Link to="/runs">{t("nav.runs")}</Link>
          <Link to="/workflows">{t("nav.workflows")}</Link>
          <Link to="/plugins">{t("docs.pluginCatalog")}</Link>
        </div>
      </aside>

      <main className="docsProductContent">
        {renderContent()}
      </main>
    </div>
  );
}

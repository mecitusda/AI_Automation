import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { fetchTemplates, installTemplate } from "../api/templates";
import type { TemplateSummary } from "../api/templates";

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchTemplates();
        setTemplates(data);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleInstall = async (id: string) => {
    setInstallingId(id);
    try {
      const result = await installTemplate(id);
      navigate(`/workflows/${result.id}/edit`);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Install failed");
    } finally {
      setInstallingId(null);
    }
  };

  if (loading) return <div className="pageLayout"><div className="spinner" /></div>;

  return (
    <div className="pageLayout">
      <header className="pageHeader">
        <h1 className="title">Templates</h1>
        <div className="meta">
          <Link to="/workflows">Workflows</Link>
          {" · "}
          <Link to="/runs">Runs</Link>
        </div>
      </header>
      <main className="pageContent">
      <p style={{ marginBottom: 16, fontSize: "1.6rem" }}>
        Start from a template and customize in the workflow builder.
      </p>
      <div className="cards">
        {templates.map((t) => (
          <div key={t.id} className="card">
            <h3 className="card-title">{t.name}</h3>
            <span className="badge" style={{ marginBottom: 8 }}>
              {t.category}
            </span>
            <p style={{ marginBottom: 12, opacity: 0.9 }}>{t.description}</p>
            <button
              onClick={() => handleInstall(t.id)}
              disabled={installingId !== null}
            >
              {installingId === t.id ? "Installing…" : "Install"}
            </button>
          </div>
        ))}
      </div>
      </main>
    </div>
  );
}

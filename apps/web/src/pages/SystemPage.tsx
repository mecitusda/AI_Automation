import { useEffect, useState } from "react";
import { fetchMonitoring, fetchMonitoringPerf, fetchStuckRuns, healRun, type MonitoringPerfRoute, type MonitoringSummary, type StuckRun } from "../api/monitoring";
import { Button, Card, PageState, useToast } from "../components/ui";
import { useI18n } from "../hooks/useI18n";

export default function SystemPage() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [perf, setPerf] = useState<MonitoringPerfRoute[]>([]);
  const [stuckRuns, setStuckRuns] = useState<StuckRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { notify } = useToast();

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSummary, nextPerf, nextStuck] = await Promise.all([
        fetchMonitoring(),
        fetchMonitoringPerf(),
        fetchStuckRuns()
      ]);
      setSummary(nextSummary);
      setPerf(nextPerf.routes || []);
      setStuckRuns(nextStuck.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("system.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onHeal = async (runId: string) => {
    await healRun(runId);
    notify(t("system.requeued"), "success");
    load();
  };

  return (
    <div className="pageLayout">
      <header className="pageHeader">
        <div>
          <h1 className="title">{t("nav.system")}</h1>
          <p className="subtle">{t("system.subtitle")}</p>
        </div>
        <Button onClick={load} disabled={loading}>{t("common.refresh")}</Button>
      </header>

      <main className="pageContent">
        {loading ? <div className="spinner" /> : null}
        {!loading && error ? (
          <PageState title={t("system.loadFailed")} message={error} action={<Button onClick={load}>{t("common.retry")}</Button>} />
        ) : null}
        {!loading && !error && summary ? (
          <>
            <div className="uiGrid">
              <Card>
                <h3>{t("system.inflight")}</h3>
                <p className="metricValue">{summary.globalInflight} / {summary.globalMax}</p>
              </Card>
              <Card>
                <h3>{t("system.readyQueue")}</h3>
                <p className="metricValue">{summary.readyQueueLen}</p>
              </Card>
              <Card>
                <h3>{t("system.tokens")}</h3>
                <p className="metricValue">{summary.globalTokensCount}</p>
              </Card>
              <Card>
                <h3>{t("system.stuckRuns")}</h3>
                <p className="metricValue">{summary.stuckRuns}</p>
              </Card>
            </div>

            <Card style={{ marginTop: 18 }}>
              <h3>{t("system.healQueue")}</h3>
              {stuckRuns.length === 0 ? (
                <p className="subtle">{t("system.noStuckRuns")}</p>
              ) : (
                <div className="systemList">
                  {stuckRuns.map((run) => (
                    <div key={run.id} className="systemList__row">
                      <span>#{run.id}</span>
                      <span>{Math.round(run.ageMs / 1000)}s</span>
                      <span>{run.stepCount} {t("runs.steps")}</span>
                      <Button onClick={() => onHeal(run.id)}>{t("system.heal")}</Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card style={{ marginTop: 18 }}>
              <h3>{t("system.slowestRoutes")}</h3>
              <div className="systemList">
                {perf.slice(0, 10).map((route) => (
                  <div key={route.route} className="systemList__row">
                    <span>{route.route}</span>
                    <span>avg {Math.round(route.avgMs)}ms</span>
                    <span>p95 {route.p95Ms == null ? "n/a" : `${Math.round(route.p95Ms)}ms`}</span>
                    <span>{route.errorCount} {t("system.errors")}</span>
                  </div>
                ))}
              </div>
            </Card>
          </>
        ) : null}
      </main>
    </div>
  );
}

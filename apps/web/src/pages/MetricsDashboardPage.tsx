import { useEffect, useState } from "react";
import { fetchDashboard, type DashboardMetrics } from "../api/metrics";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const WINDOW_OPTS = [
  { label: "1 hour", sec: 3600 },
  { label: "6 hours", sec: 6 * 3600 },
  { label: "24 hours", sec: 24 * 3600 },
];

export default function MetricsDashboardPage() {
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowSec, setWindowSec] = useState(3600);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDashboard(windowSec)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [windowSec]);

  if (loading && !data) return <div className="page"><div className="spinner" /></div>;
  if (!data) return <div className="page">Failed to load metrics</div>;

  const runsPerWorkflowData = (data.runsPerWorkflow || []).map((w) => ({
    name: w.workflowId.slice(-6),
    fullId: w.workflowId,
    count: w.count,
  }));
  const colors = ["#3b82f6", "#22c55e", "#eab308", "#ef4444", "#a855f7"];

  return (
    <div className="page">
      <div className="header">
        <h1>Metrics Dashboard</h1>
        <div className="meta">
          Window:{" "}
          <select
            value={windowSec}
            onChange={(e) => setWindowSec(Number(e.target.value))}
          >
            {WINDOW_OPTS.map((o) => (
              <option key={o.sec} value={o.sec}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="cards" style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <div className="card" style={{ minWidth: 160 }}>
          <h3>Avg run duration</h3>
          <p style={{ fontSize: "1.5rem", margin: 0 }}>
            {data.avgRunDurationMs != null
              ? `${Math.round(data.avgRunDurationMs)} ms`
              : "—"}
          </p>
        </div>
        <div className="card" style={{ minWidth: 160 }}>
          <h3>Step failure rate</h3>
          <p style={{ fontSize: "1.5rem", margin: 0 }}>
            {data.stepFailureRate != null
              ? `${(data.stepFailureRate * 100).toFixed(1)}%`
              : "—"}
          </p>
        </div>
        <div className="card" style={{ minWidth: 160 }}>
          <h3>Active runs</h3>
          <p style={{ fontSize: "1.5rem", margin: 0 }}>{data.activeRuns}</p>
        </div>
        <div className="card" style={{ minWidth: 160 }}>
          <h3>Step executions</h3>
          <p style={{ fontSize: "1.5rem", margin: 0 }}>
            {data.stepExecutionCount}
          </p>
        </div>
      </div>
      {runsPerWorkflowData.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Runs per workflow</h3>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={runsPerWorkflowData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip
                  formatter={(value: unknown) => [String(value), "Runs"]}
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload?.fullId ?? ""
                  }
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]}>
                  {runsPerWorkflowData.map((_, i) => (
                    <Cell key={i} fill={colors[i % colors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

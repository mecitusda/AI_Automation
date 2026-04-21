// src/components/MonitoringCard.tsx
import { healRun } from "../api/monitoring";
import { useMonitoring } from "../hooks/useMonitoring";
import { useStuck } from "../hooks/useStuck";

type Props = {
  enabled?: boolean;
};

export default function MonitoringCard({ enabled = true }: Props) {
  const data = useMonitoring(enabled);
  const stuckRuns = useStuck(enabled);
  if (!enabled) return null;
  if (!data) return null;

  const healthy =
    data.sanity.inflightEqualsTokens &&
    !data.sanity.inflightOverMax;

  return (
    <>
    <div className="section">
      <div className="monitoring-header">
        <h3>System Monitoring</h3>
        <span className={healthy ? "badge-ok" : "badge-warn"}>
          {healthy ? "Healthy" : "Warning"}
        </span>
      </div>

      <div className="monitoring-grid">
        <div>
          <strong>Inflight</strong>
          <p>{data.globalInflight} / {data.globalMax}</p>
        </div>

        <div>
          <strong>Tokens</strong>
          <p>{data.globalTokensCount}</p>
        </div>

        <div>
          <strong>Ready Queue</strong>
          <p>{data.readyQueueLen}</p>
        </div>

        <div>
          <strong>Stuck Runs</strong>
          <p>{data.stuckRuns}</p>
        </div>
      </div>
    </div>
    {stuckRuns.length > 0 && (
  <div className="stuckBox">
    <h4>Stuck Runs</h4>
    {stuckRuns.map((r) => (
      <div key={r.id} className="stuckItem">
        <span>#{r.id}</span>
        <span>{Math.floor(r.ageMs / 1000)}s</span>
        <button
          onClick={async () => {
            await healRun(r.id);
          }}
        >
          Heal
        </button>
      </div>
    ))}
  </div>
)}</>
  );
  
}
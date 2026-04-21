import { useEffect, useState } from "react";
import { fetchSummary } from "../api/metrics";
import type { SummaryMetrics } from "../api/metrics";
export function useSummary(windowSec = 3600, enabled = true) {
  const [data, setData] = useState<SummaryMetrics | null>(null);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    let mounted = true;

    const load = async () => {
      try {
        const res = await fetchSummary(windowSec);
        if (mounted) setData(res);
      } catch (err) {
        if ((err as Error)?.message !== "Forbidden") {
          console.error("Summary fetch error", err);
        }
      }
    };

    load();
    const interval = setInterval(load, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [windowSec, enabled]);

  return data;
}
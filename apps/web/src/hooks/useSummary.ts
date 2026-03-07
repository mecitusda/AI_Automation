import { useEffect, useState } from "react";
import { fetchSummary } from "../api/metrics";
import type { SummaryMetrics } from "../api/metrics";
export function useSummary(windowSec = 3600) {
  const [data, setData] = useState<SummaryMetrics | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const res = await fetchSummary(windowSec);
        if (mounted) setData(res);
      } catch (err) {
        console.error("Summary fetch error", err);
      }
    };

    load();
    const interval = setInterval(load, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [windowSec]);

  return data;
}
// src/hooks/useMonitoring.ts
import { useEffect, useState } from "react";
import { fetchMonitoring } from "../api/monitoring";
import type { MonitoringSummary } from "../api/monitoring";
export function useMonitoring(enabled = true) {
  const [data, setData] = useState<MonitoringSummary | null>(null);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    let mounted = true;

    async function load() {
      try {
        const res = await fetchMonitoring();
        if (mounted) setData(res);
      } catch (err) {
        if ((err as Error)?.message !== "Forbidden") {
          console.error("Monitoring fetch error", err);
        }
      }
    }

    load();
    const interval = setInterval(load, 1000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [enabled]);

  return data;
}
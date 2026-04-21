import { useEffect, useState } from "react";
import { fetchStuckRuns } from "../api/monitoring";
import type { StuckRun } from "../api/monitoring";
export function useStuck(enabled = true) {
  const [data, setData] = useState<StuckRun[]>([]);

  useEffect(() => {
    if (!enabled) {
      setData([]);
      return;
    }
    let alive = true;

    const load = async () => {
      try {
        const res = await fetchStuckRuns();
        if (!alive) return;
        setData(res.data);
      } catch (err) {
        if (!alive) return;
        if ((err as Error)?.message !== "Forbidden") {
          console.error("Stuck fetch error", err);
        }
      }
    };

    load();
    const t = setInterval(load, 5000);

    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [enabled]);

  return data;
}
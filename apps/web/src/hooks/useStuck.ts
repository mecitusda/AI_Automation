import { useEffect, useState } from "react";
import { fetchStuckRuns } from "../api/monitoring";
import type { StuckRun } from "../api/monitoring";
export function useStuck() {
  const [data, setData] = useState<StuckRun[]>([]);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      const res = await fetchStuckRuns();
      if (!alive) return;
      setData(res.data);
    };

    load();
    const t = setInterval(load, 5000);

    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return data;
}
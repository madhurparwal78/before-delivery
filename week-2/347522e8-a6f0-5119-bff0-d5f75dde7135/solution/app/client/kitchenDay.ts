// "Today" is the server's kitchen date: read from the stations endpoint, which also syncs the clock.

import { useEffect, useState } from "react";
import type { StationsResponse } from "../shared/api.js";
import { api } from "./api.js";
import { syncServerClock } from "./clock.js";

async function fetchKitchenToday(): Promise<string | null> {
  const result = await api<StationsResponse>("/api/stations");
  if (!result.ok) return null;
  syncServerClock(result.data.server_now);
  return result.data.date;
}

export function useKitchenToday(): string | null {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void fetchKitchenToday().then((date) => {
      if (live) setToday(date);
    });
    return () => {
      live = false;
    };
  }, []);
  return today;
}

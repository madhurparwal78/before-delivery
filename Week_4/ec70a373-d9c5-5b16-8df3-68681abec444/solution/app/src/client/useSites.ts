// The sites of the caller's tenant with each site's clock as the server reports it, refreshed every minute.
import { useEffect, useState } from "react";
import type { Site } from "../shared/api.ts";
import { api } from "./api.ts";
import { reloadsPaused } from "./session.ts";

const MINUTE_MS = 60_000;

export function useSites(): Site[] {
  const [sites, setSites] = useState<Site[]>([]);
  useEffect(() => {
    const load = async (): Promise<void> => {
      const result = await api<{ sites: Site[] }>("/api/sites");
      if (result.ok) setSites(result.data.sites);
    };
    void load();
    const id = setInterval(() => {
      if (!reloadsPaused()) void load();
    }, MINUTE_MS);
    return () => clearInterval(id);
  }, []);
  return sites;
}

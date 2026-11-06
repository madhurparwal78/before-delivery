// Small shared reads used by several screens.
import { useEffect, useState } from "preact/hooks";
import type { DialDay, Station, Tenant } from "../shared/api";
import { api } from "./api";
import { act } from "./feedback";

let stationCache: Station[] | null = null;

/** Station names and rates, read once from the day API. */
export function useStations(): Map<string, Station> {
  const [stations, setStations] = useState<Station[]>(stationCache ?? []);
  useEffect(() => {
    if (stationCache) return;
    void act({}, () => api<DialDay>("GET", "/api/dial")).then((outcome) => {
      if (!outcome.ok) return;
      stationCache = outcome.value.stations.map(({ id, name, kind, hourly_rate_cents }) => ({ id, name, kind, hourly_rate_cents }));
      setStations(stationCache);
    });
  }, []);
  return new Map(stations.map((s) => [s.id, s]));
}

export function loadTenants(): Promise<Tenant[]> {
  return api<{ tenants: Tenant[] }>("GET", "/api/tenants").then((r) => r.tenants);
}

/** "Certificate of insurance" → "certificate of insurance" for use mid-sentence. */
export function midSentence(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

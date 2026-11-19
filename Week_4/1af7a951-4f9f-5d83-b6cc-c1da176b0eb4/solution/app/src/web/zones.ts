import { useEffect, useState } from "react";
import { api } from "./api";

let accepted: Promise<string[]> | null = null;

/** The server's accepted home time zones in their published order, fetched once per page. */
export function useTimeZones(): string[] | null {
  const [zones, setZones] = useState<string[] | null>(null);
  useEffect(() => {
    accepted ??= api<{ zones: string[] }>("GET", "/api/time-zones").then((result) => result.data.zones ?? []);
    accepted.then(setZones, () => {
      accepted = null;
    });
  }, []);
  return zones;
}

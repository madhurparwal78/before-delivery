// Station names for printing codes in full; the seeded list never changes while the app runs.
import { useCallback, useEffect, useState } from "react";
import type { Station } from "../../shared/api";
import { api } from "./api";

let request: Promise<Station[]> | null = null;

export function useStationNames(): (code: string) => string {
  const [stations, setStations] = useState<Station[]>([]);
  useEffect(() => {
    request ??= api<{ stations: Station[] }>("/api/stations").then((b) => b.stations, () => {
      request = null;
      return [];
    });
    let live = true;
    void request.then((list) => live && setStations(list));
    return () => {
      live = false;
    };
  }, []);
  return useCallback((code: string) => stations.find((s) => s.code === code)?.name ?? code, [stations]);
}

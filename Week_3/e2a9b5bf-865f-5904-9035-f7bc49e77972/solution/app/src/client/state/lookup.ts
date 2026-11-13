import { useMemo } from "preact/hooks";
import { newestFirst } from "../../shared/completeness";
import type { CatalogueObject, Observation } from "../../shared/types";
import { useSelect } from "../lib/store";
import { effective, type Effective } from "./effective";
import { app } from "./model";

/** The device copy with queued changes applied: what every screen shows. */
export function useEffective(): Effective {
  const server = useSelect(app, (s) => s.server);
  const journal = useSelect(app, (s) => s.journal);
  return useMemo(() => effective(server, journal), [server, journal]);
}

export function objectOf(objects: CatalogueObject[] | null, id: string): CatalogueObject | undefined {
  return objects?.find((o) => o.id === id);
}

/** An object's observations, newest first (the shared ordering), with no-time ones last. */
export function newestObservations(eff: Effective, objectId: string): Observation[] {
  return Object.values(eff.observations)
    .filter((o) => o.object_id === objectId)
    .map((o) => ({ ...o, created_seq: eff.createdSeq[o.id] ?? 0 }))
    .sort(newestFirst);
}

import type { Snapshot } from "../../shared/types";

/** The number of top-level objects a snapshot shows: 3D objects, Block Lab output objects or circuit components. */
export function meshCount(snapshot: Snapshot): number {
  return snapshot.kind === "circuit" ? snapshot.components.length : snapshot.objects.length;
}

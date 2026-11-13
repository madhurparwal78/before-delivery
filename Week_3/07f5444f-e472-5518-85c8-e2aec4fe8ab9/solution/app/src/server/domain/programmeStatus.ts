// Programme state edges reachable through the transition endpoint (publish has its own guards).

import type { ProgrammeStatus } from "../../shared/api.js";

const TRANSITION_EDGES: ReadonlySet<string> = new Set([
  "draft>in_preparation",
  "in_preparation>draft",
  "published>in_performance",
  "in_performance>closed",
]);

export function transitionAllowed(from: ProgrammeStatus, to: ProgrammeStatus): boolean {
  return TRANSITION_EDGES.has(`${from}>${to}`);
}

/** Works may be added while a programme is a draft or in preparation. */
export function worksMayBeAdded(status: ProgrammeStatus): boolean {
  return status === "draft" || status === "in_preparation";
}

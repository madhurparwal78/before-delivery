// The renter state machine, decided here only. Operator transitions and the automatic ones
// (documents uploaded, compliance scan, approval) all pass through `changeRenterStatus`.

import type { RenterStatus } from "../../shared/api.js";
import type { Tx } from "../db.js";
import { fail } from "../http/errors.js";

export const RENTER_STATUSES: readonly RenterStatus[] = ["applied", "documents_review", "active", "suspended", "offboarded"];

type Trigger = "operator" | "automatic";

/** Legal transitions and who makes them. */
const TRANSITIONS: readonly { from: readonly RenterStatus[]; to: RenterStatus; by: Trigger }[] = [
  { from: ["applied"], to: "documents_review", by: "automatic" },
  { from: ["documents_review"], to: "active", by: "operator" },
  { from: ["active"], to: "suspended", by: "automatic" },
  { from: ["suspended"], to: "active", by: "automatic" },
  { from: ["suspended"], to: "active", by: "operator" },
  { from: ["applied", "documents_review", "active", "suspended"], to: "offboarded", by: "operator" },
];

function isLegalTransition(from: RenterStatus, to: RenterStatus, by: Trigger): boolean {
  return TRANSITIONS.some((t) => t.by === by && t.to === to && t.from.includes(from));
}

/** An operator request that is not a legal transition answers 409 invalid_transition. */
export function assertOperatorTransition(from: RenterStatus, to: RenterStatus): void {
  if (!isLegalTransition(from, to, "operator")) throw fail(409, "invalid_transition", { from, to });
}

/** Applies an automatic transition when it is legal from the current status; returns whether it happened. */
export async function changeRenterStatus(tx: Tx, renterId: string, from: RenterStatus, to: RenterStatus): Promise<boolean> {
  if (!isLegalTransition(from, to, "automatic") && !isLegalTransition(from, to, "operator")) return false;
  const result = await tx.query("UPDATE renters SET status = $3 WHERE id = $1 AND status = $2", [renterId, from, to]);
  return (result.rowCount ?? 0) > 0;
}

// The dot ledger: spend entries and return entries. Every total is derived from it here, and only here.
import { newId, type Db } from "./db.js";
import { fail } from "./errors.js";

export interface LedgerEntry {
  id: string;
  participant_id: string;
  cluster_id: string;
  kind: "spend" | "return";
  cancels: string | null;
  seq: number;
}

export async function loadLedger(t: Db, workshopId: string): Promise<LedgerEntry[]> {
  return t.rows<LedgerEntry>("SELECT id, participant_id, cluster_id, kind, cancels, seq FROM dot_ledger WHERE workshop_id = $1 ORDER BY seq", [
    workshopId,
  ]);
}

/** Spend entries no return entry has cancelled. */
function liveSpends(ledger: readonly LedgerEntry[]): LedgerEntry[] {
  const cancelled = new Set(ledger.filter((e) => e.kind === "return").map((e) => e.cancels));
  return ledger.filter((e) => e.kind === "spend" && !cancelled.has(e.id));
}

export function dotTotal(ledger: readonly LedgerEntry[], clusterId: string, participantId?: string): number {
  return liveSpends(ledger).filter((e) => e.cluster_id === clusterId && (participantId === undefined || e.participant_id === participantId)).length;
}

/** The budget minus the caller's live spends on every cluster, trashed, purged or not. */
export function dotsRemaining(budget: number, ledger: readonly LedgerEntry[], participantId: string): number {
  return budget - liveSpends(ledger).filter((e) => e.participant_id === participantId).length;
}

/** Runs under the workshop lock, so spends commit one at a time against the budget. */
export async function spendDot(t: Db, workshopId: string, budget: number, participantId: string, clusterId: string) {
  const ledger = await loadLedger(t, workshopId);
  const remaining = dotsRemaining(budget, ledger, participantId);
  if (remaining <= 0) fail("budget_exhausted");
  const id = newId();
  await t.run("INSERT INTO dot_ledger (id, workshop_id, participant_id, cluster_id, kind) VALUES ($1, $2, $3, $4, 'spend')", [
    id,
    workshopId,
    participantId,
    clusterId,
  ]);
  return { id, remaining: remaining - 1 };
}

async function writeReturn(t: Db, workshopId: string, spend: LedgerEntry) {
  await t.run("INSERT INTO dot_ledger (id, workshop_id, participant_id, cluster_id, kind, cancels) VALUES ($1, $2, $3, $4, 'return', $5)", [
    newId(),
    workshopId,
    spend.participant_id,
    spend.cluster_id,
    spend.id,
  ]);
}

/** Cancels the caller's most recent live spend on the cluster. */
export async function returnDot(t: Db, workshopId: string, budget: number, participantId: string, clusterId: string) {
  const ledger = await loadLedger(t, workshopId);
  const spend = liveSpends(ledger)
    .filter((e) => e.participant_id === participantId && e.cluster_id === clusterId)
    .at(-1);
  if (!spend) fail("no_dot_to_return");
  await writeReturn(t, workshopId, spend);
  return dotsRemaining(budget, ledger, participantId) + 1;
}

/** Deleting a cluster returns every live spend on it, in the same transaction as the delete. */
export async function returnAllOn(t: Db, workshopId: string, clusterId: string): Promise<void> {
  const ledger = await loadLedger(t, workshopId);
  for (const spend of liveSpends(ledger).filter((e) => e.cluster_id === clusterId)) await writeReturn(t, workshopId, spend);
}

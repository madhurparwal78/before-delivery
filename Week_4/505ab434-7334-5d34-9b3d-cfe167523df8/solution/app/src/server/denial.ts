// A 403 refusal is audited as `denied` in a transaction of its own (the refused work is rolled back).
import { transaction, type AuditDraft, type Tx } from "./db.ts";
import { ApiError, forbidden } from "./errors.ts";

export class Denied extends ApiError {
  constructor(
    code: string,
    message: string,
    readonly record: Omit<AuditDraft, "outcome" | "before" | "after">,
  ) {
    super(403, code, message);
  }
}

/** Runs `work` in a transaction; a `Denied` thrown inside rolls it back, writes one denied audit record and re-throws. */
export async function withDenialAudit<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await transaction(work);
  } catch (error) {
    if (error instanceof Denied) {
      await transaction(async (tx) => tx.audit({ ...error.record, before: null, after: null, outcome: "denied" }));
      throw new ApiError(error.status, error.code, error.message);
    }
    throw error;
  }
}

/** A refusal decided outside any open transaction: one committed `denied` record, then the 403. */
export async function refuse(draft: Omit<AuditDraft, "before" | "after" | "outcome">, error: ApiError = forbidden()): Promise<never> {
  await transaction(async (tx) => tx.audit({ ...draft, before: null, after: null, outcome: "denied" }));
  throw error;
}

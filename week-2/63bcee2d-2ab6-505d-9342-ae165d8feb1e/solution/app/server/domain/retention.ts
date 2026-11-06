import { defectsEndOn } from "./calendar.js";
import { divideHalfUp, percentOf } from "./money.js";

// Interim certificates and retention (brief: Certificates and retention, Retention ledger). The one place
// the retention this period, its cap, the half and final releases and the ledger pairs are decided.

const RETENTION_BASIS_POINTS = 1000; // 10% of each period's valuation
const CAP_BASIS_POINTS = 500; // until 5% of the contract sum is held

interface InterimFigures {
  valuationThisPeriodCents: number;
  retentionThisPeriodCents: number;
  amountDueCents: number;
}

export function interimFigures(input: {
  grossValuationCents: number; previousGrossCents: number; heldCents: number; contractSumCents: number; practicalCompletion: boolean;
}): InterimFigures {
  const valuation = input.grossValuationCents - input.previousGrossCents;
  const cap = percentOf(input.contractSumCents, CAP_BASIS_POINTS);
  const retention = input.practicalCompletion ? 0 : Math.min(percentOf(valuation, RETENTION_BASIS_POINTS), cap - input.heldCents);
  return { valuationThisPeriodCents: valuation, retentionThisPeriodCents: retention, amountDueCents: valuation - retention };
}

/** Half of the retention held, rounded once, released at practical completion. */
export const halfRelease = (heldCents: number): number => Number(divideHalfUp(BigInt(heldCents), 2n));

export type RetentionAction = "issue" | "record_practical_completion" | "release_final";

interface RetentionPosition {
  hasContract: boolean;
  practicalCompletionOn: string | null;
  defectsPeriodMonths: number;
  finalReleased: boolean;
  /** Today in Hong Kong. */
  today: string;
}

type RetentionRefusal =
  | { kind: "no_contract" }
  | { kind: "illegal_transition"; from: string }
  | { kind: "defects_period_running"; defectsEndOn: string };

/**
 * Why a certificate action is refused, or null when it is allowed: certificates need a contract, practical
 * completion is recorded once, and the final release comes once, from the day after the defects end date.
 */
export function retentionRefusal(position: RetentionPosition, action: RetentionAction): RetentionRefusal | null {
  if (!position.hasContract) return { kind: "no_contract" };
  const pc = position.practicalCompletionOn;
  if (action === "issue") return null;
  if (action === "record_practical_completion") return pc === null ? null : { kind: "illegal_transition", from: "practical_completion_recorded" };
  if (pc === null) return { kind: "illegal_transition", from: "before_practical_completion" };
  if (position.finalReleased) return { kind: "illegal_transition", from: "final_retention_released" };
  const end = defectsEndOn(pc, position.defectsPeriodMonths);
  return position.today > end ? null : { kind: "defects_period_running", defectsEndOn: end };
}

/**
 * The certificate actions offered to a director or project lead now. An early final release stays on offer,
 * so pressing it says when the defects period ends.
 */
export function retentionActions(position: RetentionPosition): RetentionAction[] {
  return (["issue", "record_practical_completion", "release_final"] as const).filter((action) => {
    const refusal = retentionRefusal(position, action);
    return refusal === null || refusal.kind === "defects_period_running";
  });
}

interface LedgerEntry {
  kind: "hold" | "release";
  account: "contractor_payable" | "retention_held";
  side: "debit" | "credit";
  amountCents: number;
}

/** One balanced debit and credit pair for a movement; a movement of zero cents posts nothing. */
export function ledgerPair(kind: "hold" | "release", amountCents: number): LedgerEntry[] {
  if (amountCents === 0) return [];
  const [debit, credit] = kind === "hold"
    ? (["contractor_payable", "retention_held"] as const)
    : (["retention_held", "contractor_payable"] as const);
  return [
    { kind, account: debit, side: "debit", amountCents },
    { kind, account: credit, side: "credit", amountCents },
  ];
}

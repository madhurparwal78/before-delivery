/**
 * The payment schedule and its cent allocation.
 *
 * One pass allocates every stage: locked (confirmed) stages keep what they
 * already hold, middle stages are allocated in proportion to line gross, and
 * the final stage takes the residual so each line's allocations, less returned
 * draws, sum exactly to its gross and VAT.
 */

import { STAGE_LABELS } from '../../shared/seed.js';
import type { Allocation, Stage, StageName, StageStatus } from '../../shared/types.js';
import { STAGE_ORDER, allocateProportional, allocateResidual, levelAmounts } from './money.js';

export interface LineForAllocation {
  id: string;
  grossCents: number;
  vatCents: number;
  ratePct: number;
}

export interface StageForAllocation {
  stage: StageName;
  amountCents: number;
  status: StageStatus;
  dueDate: string | null;
  attempts: number;
  confirmedAt: string | null;
  vatCorrectedCents: number;
  /** Allocations a confirmed stage keeps unchanged. */
  locked: Allocation[] | null;
  /** Gross and VAT already returned from this stage's allocations, by line. */
  returnedByLine: ReadonlyMap<string, { grossCents: number; vatCents: number }>;
}

/** A stage holding money the rider will not be asked for again. */
export function isLockedStatus(status: StageStatus): boolean {
  return status === 'paid';
}

/**
 * Allocate every stage against the current line amounts.
 *
 * Confirmed stages are never changed. Their allocations still consume line
 * gross and VAT, less anything a refund has returned from them.
 */
export function allocateStages(
  lines: readonly LineForAllocation[],
  stages: readonly StageForAllocation[],
): Stage[] {
  const consumed = new Map<string, { grossCents: number; vatCents: number }>();
  const addConsumed = (lineId: string, grossCents: number, vatCents: number): void => {
    const current = consumed.get(lineId) ?? { grossCents: 0, vatCents: 0 };
    consumed.set(lineId, {
      grossCents: current.grossCents + grossCents,
      vatCents: current.vatCents + vatCents,
    });
  };

  const lastStage = stages[stages.length - 1]?.stage;
  const result: Stage[] = [];

  for (const stage of stages) {
    let allocations: Allocation[];

    if (stage.locked) {
      allocations = stage.locked;
      for (const allocation of allocations) {
        const returned = stage.returnedByLine.get(allocation.lineId) ?? { grossCents: 0, vatCents: 0 };
        addConsumed(
          allocation.lineId,
          allocation.grossCents - returned.grossCents,
          allocation.vatCents - returned.vatCents,
        );
      }
    } else if (stage.stage === lastStage) {
      allocations = allocateResidual(lines, consumed).map((share) => ({
        lineId: share.lineId,
        grossCents: share.grossCents,
        vatCents: share.vatCents,
        netCents: share.netCents,
      }));
      for (const allocation of allocations) {
        addConsumed(allocation.lineId, allocation.grossCents, allocation.vatCents);
      }
    } else {
      allocations = allocateProportional(
        stage.amountCents,
        lines.map((line) => ({ lineId: line.id, weightCents: line.grossCents, ratePct: line.ratePct })),
      ).map((share) => ({
        lineId: share.lineId,
        grossCents: share.grossCents,
        vatCents: share.vatCents,
        netCents: share.netCents,
      }));
      for (const allocation of allocations) {
        addConsumed(allocation.lineId, allocation.grossCents, allocation.vatCents);
      }
    }

    result.push({
      stage: stage.stage,
      label: STAGE_LABELS[stage.stage],
      dueDate: stage.dueDate,
      amountCents: stage.amountCents,
      // VAT is shown as due on each payment received.
      vatCents: allocations.reduce((sum, a) => sum + a.vatCents, 0),
      vatCorrectedCents: stage.vatCorrectedCents,
      status: stage.status,
      attempts: stage.attempts,
      confirmedAt: stage.confirmedAt,
      allocations,
    });
  }

  return result;
}

/**
 * Re-level the unpaid balance across the unpaid stages. Confirmed stages never
 * change, so the balance is the current total less money confirmed and not
 * returned.
 */
export function respreadAmounts(
  totalCents: number,
  stages: readonly { stage: StageName; status: StageStatus; amountCents: number }[],
  confirmedNotReturnedCents: number,
): Map<StageName, number> {
  const unpaid = stages.filter((stage) => !isLockedStatus(stage.status));
  const balance = totalCents - confirmedNotReturnedCents;
  const levelled = levelAmounts(balance, unpaid.length);
  const amounts = new Map<StageName, number>();
  for (const stage of stages) amounts.set(stage.stage, stage.amountCents);
  unpaid.forEach((stage, index) => amounts.set(stage.stage, levelled[index] as number));
  return amounts;
}

export { STAGE_ORDER };

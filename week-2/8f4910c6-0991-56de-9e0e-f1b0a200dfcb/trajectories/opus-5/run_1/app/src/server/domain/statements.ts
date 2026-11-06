import type { MovementKind, Statement, StatementLine } from '../../shared/types.js';

export type MovementSummary = {
  movementId: string;
  kind: MovementKind;
  reference: string;
  officeDate: string;
  client: string;
  description: string;
  amountCents: number;
  reversed: boolean;
  reversesBooking: boolean;
  createdAt: number;
};

/** Booking earnings, net of their reversals, recoup advances oldest first. */
function recoupAdvances(movements: MovementSummary[]): Array<{
  movementId: string;
  amountCents: number;
  recoupedCents: number;
  outstandingCents: number;
}> {
  const earnings = movements
    .filter((movement) => movement.kind === 'booking' || movement.reversesBooking)
    .reduce((sum, movement) => sum + movement.amountCents, 0);
  let pool = Math.max(0, earnings);
  const advances = movements.filter((movement) => movement.kind === 'advance' && !movement.reversed);
  return advances.map((advance) => {
    const amount = Math.abs(advance.amountCents);
    const recouped = Math.min(pool, amount);
    pool -= recouped;
    return {
      movementId: advance.movementId,
      amountCents: advance.amountCents,
      recoupedCents: recouped,
      outstandingCents: amount - recouped,
    };
  });
}

export function buildStatement(input: {
  talentId: string;
  displayName: string;
  month: string;
  movements: MovementSummary[];
}): Statement {
  const monthStart = `${input.month}-01`;
  const monthEnd = `${input.month}-31`;
  const ordered = [...input.movements].sort(
    (a, b) => a.officeDate.localeCompare(b.officeDate) || a.createdAt - b.createdAt,
  );
  const openingBalanceCents = ordered
    .filter((movement) => movement.officeDate < monthStart)
    .reduce((sum, movement) => sum + movement.amountCents, 0);
  const inMonth = ordered.filter(
    (movement) => movement.officeDate >= monthStart && movement.officeDate <= monthEnd,
  );

  let balance = openingBalanceCents;
  const lines: StatementLine[] = inMonth.map((movement) => {
    balance += movement.amountCents;
    return {
      movementId: movement.movementId,
      officeDate: movement.officeDate,
      kind: movement.kind,
      reference: movement.reference,
      client: movement.client,
      description: movement.description,
      amountCents: movement.amountCents,
      balanceCents: balance,
    };
  });

  const sumOf = (kind: MovementKind): number =>
    lines.filter((line) => line.kind === kind).reduce((sum, line) => sum + line.amountCents, 0);
  const netCents = lines.reduce((sum, line) => sum + line.amountCents, 0);

  return {
    talentId: input.talentId,
    displayName: input.displayName,
    month: input.month,
    openingBalanceCents,
    lines,
    totals: {
      earningsCents: sumOf('booking'),
      advancesCents: sumOf('advance'),
      reversalsCents: sumOf('reversal'),
      netCents,
    },
    closingBalanceCents: openingBalanceCents + netCents,
    advances: recoupAdvances(ordered.filter((movement) => movement.officeDate <= monthEnd)),
  };
}

/** Money rules: VAT extraction, the payment schedule and the cent allocation. Integer cents only. */
import type { Allocation, Country, FitResult, Fulfilment, Line, Quote, RegCountry, Stage, StageName } from '../shared/types.js';
import { FIXED, INSPECTION_FEES, VAT_RATE, WORKSHOP_RATE, type Bike, type Hub, type Pack } from './catalogue.js';
import { addMonthsAnchored } from './clock.js';

export const STAGES: readonly StageName[] = ['deposit', 'instalment-1', 'instalment-2', 'instalment-3'];
export const STAGE_LABELS: Record<StageName, string> = {
  deposit: 'Deposit', 'instalment-1': 'Instalment 1', 'instalment-2': 'Instalment 2', 'instalment-3': 'Instalment 3',
};

/** VAT contained in a gross amount: gross × rate ÷ (100 + rate), rounded half up. */
export function vatOf(gross: number, ratePct: number): number {
  const den = 100 + ratePct;
  return Math.floor((2 * gross * ratePct + den) / (2 * den));
}

/** Deposit is 20 percent rounded half up; the rest splits in three, leftover cents to the earliest. */
export function spread(total: number): number[] {
  const deposit = Math.floor((total * 20 * 2 + 100) / 200);
  const rest = total - deposit;
  const each = Math.floor(rest / 3);
  const left = rest - each * 3;
  return [deposit, ...[0, 1, 2].map((i) => each + (i < left ? 1 : 0))];
}

/** Largest remainder: floor shares of `amount` by weight, leftover cents one each to the largest remainders, ties earlier. */
function allocate(amount: number, weights: readonly number[], total: number): number[] {
  const parts = weights.map((w) => Math.floor((amount * w) / total));
  const remainders = weights.map((w) => (amount * w) % total);
  const order = weights.map((_, i) => i).sort((a, b) => remainders[b] - remainders[a] || a - b);
  let left = amount - parts.reduce((a, b) => a + b, 0);
  for (const i of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

/** A priced line. `vatCents` is set once refunds have moved the line's VAT off the plain extraction. */
export interface LineSpec { code: string; name: string; grossCents: number; vatRatePct: number; vatCents?: number }

export function lineVat(line: LineSpec): number {
  return line.vatCents ?? vatOf(line.grossCents, line.vatRatePct);
}

export function inspectionFee(country: RegCountry, amsterdamDate: string): number {
  const fee = INSPECTION_FEES[country];
  return amsterdamDate < fee.changesOn ? fee.beforeCents : fee.afterCents;
}

function postedRate(country: Country): number {
  return VAT_RATE[country];
}

export function kitLines(pack: Pack, hub: Hub, fulfilment: Fulfilment, country: Country, inspection: { code: string; grossCents: number } | null): LineSpec[] {
  const rate = fulfilment === 'workshop' ? WORKSHOP_RATE : postedRate(country);
  const lines: LineSpec[] = [
    { code: hub.id, name: `Hub motor ${hub.id}`, grossCents: hub.grossCents, vatRatePct: rate },
    { code: pack.id, name: `Traction pack ${pack.id}`, grossCents: pack.grossCents, vatRatePct: rate },
    { code: 'CTRL', name: FIXED.CTRL.name, grossCents: FIXED.CTRL.grossCents, vatRatePct: rate },
    { code: 'TANK-OUT', name: FIXED['TANK-OUT'].name, grossCents: FIXED['TANK-OUT'].grossCents, vatRatePct: rate },
    fulfilment === 'posted'
      ? { code: 'POST', name: FIXED.POST.name, grossCents: FIXED.POST.grossCents, vatRatePct: rate }
      : { code: 'FIT', name: FIXED.FIT.name, grossCents: FIXED.FIT.grossCents, vatRatePct: rate },
  ];
  if (inspection) lines.push({ code: inspection.code, name: 'Inspection fee', grossCents: inspection.grossCents, vatRatePct: 0 });
  return lines;
}

export function bikeLines(bike: Bike): LineSpec[] {
  return [
    { code: bike.id, name: bike.name, grossCents: bike.grossCents, vatRatePct: WORKSHOP_RATE },
    { code: 'HANDOVER', name: FIXED.HANDOVER.name, grossCents: FIXED.HANDOVER.grossCents, vatRatePct: WORKSHOP_RATE },
  ];
}

export function totals(lines: readonly LineSpec[]): { totalCents: number; vatCents: number } {
  return {
    totalCents: lines.reduce((sum, l) => sum + l.grossCents, 0),
    vatCents: lines.reduce((sum, l) => sum + lineVat(l), 0),
  };
}

export interface AllocRow { stage: StageName; lineIndex: number; grossCents: number; vatCents: number }

/**
 * Allocations for every stage that is not in `fixed`. A non-final stage is shared in proportion to the current line
 * grosses; the final stage takes each line's residual gross and VAT, so with `returned` (draws already given back,
 * per line) every line's allocations less its returned draws sum exactly to its current gross and VAT.
 */
export function allocateStages(
  lines: readonly LineSpec[],
  amounts: readonly number[],
  fixed: ReadonlyMap<StageName, readonly AllocRow[]>,
  returned: readonly { grossCents: number; vatCents: number }[],
): AllocRow[] {
  const total = lines.reduce((sum, l) => sum + l.grossCents, 0);
  const grosses = lines.map((l) => l.grossCents);
  const rows: AllocRow[] = [];
  const taken = lines.map(() => ({ gross: 0, vat: 0 }));
  for (const [index, stage] of STAGES.entries()) {
    const given = fixed.get(stage);
    if (given) {
      for (const row of given) {
        taken[row.lineIndex].gross += row.grossCents;
        taken[row.lineIndex].vat += row.vatCents;
      }
      continue;
    }
    if (index < STAGES.length - 1) {
      const shares = allocate(amounts[index], grosses, total);
      shares.forEach((gross, lineIndex) => {
        const vat = vatOf(gross, lines[lineIndex].vatRatePct);
        rows.push({ stage, lineIndex, grossCents: gross, vatCents: vat });
        taken[lineIndex].gross += gross;
        taken[lineIndex].vat += vat;
      });
    } else {
      lines.forEach((line, lineIndex) => {
        const gross = line.grossCents + returned[lineIndex].grossCents - taken[lineIndex].gross;
        const vat = lineVat(line) + returned[lineIndex].vatCents - taken[lineIndex].vat;
        rows.push({ stage, lineIndex, grossCents: gross, vatCents: vat });
      });
    }
  }
  return rows;
}

export function dueDates(anchor: string): string[] {
  return [anchor, addMonthsAnchored(anchor, 1), addMonthsAnchored(anchor, 2), addMonthsAnchored(anchor, 3)];
}

/** The four stages of a fresh order, as a quote shows them (line ids are the line codes). */
function scheduleOf(lines: readonly LineSpec[], anchor: string): Stage[] {
  const amounts = spread(totals(lines).totalCents);
  const rows = allocateStages(lines, amounts, new Map(), lines.map(() => ({ grossCents: 0, vatCents: 0 })));
  const due = dueDates(anchor);
  return STAGES.map((stage, i) => {
    const allocations: Allocation[] = rows.filter((r) => r.stage === stage).map((r) => ({
      lineId: lines[r.lineIndex].code, grossCents: r.grossCents, vatCents: r.vatCents, netCents: r.grossCents - r.vatCents,
    }));
    return {
      stage, label: STAGE_LABELS[stage], dueDate: due[i], amountCents: amounts[i],
      vatCents: allocations.reduce((sum, a) => sum + a.vatCents, 0), vatCorrectedCents: 0, status: 'scheduled' as const, attempts: 0,
      confirmedAt: null, allocations,
    };
  });
}

function quoteLines(lines: readonly LineSpec[]): Line[] {
  return lines.map((l) => ({
    id: l.code, code: l.code, name: l.name, grossCents: l.grossCents, vatRatePct: l.vatRatePct, vatCents: lineVat(l),
    netCents: l.grossCents - lineVat(l), collectedCents: 0, refundedCents: 0,
  }));
}

export function quoteOf(lines: readonly LineSpec[], anchor: string, notices: string[], fit: FitResult): Quote {
  const { totalCents, vatCents } = totals(lines);
  return {
    lines: quoteLines(lines), totalCents, vatCents, vatRatePct: lines[0]?.vatRatePct ?? 0,
    schedule: scheduleOf(lines, anchor), notices, fit,
  };
}

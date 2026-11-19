import { openDaysPhrase } from '../../shared/format';
import type { FeeLine, FeeRules, Grade } from '../../shared/types';

export interface FeeItem {
  readonly id: number;
  readonly tag: string;
  readonly name: string;
  readonly grade: Grade | null;
}

/**
 * The late line for one item: the recorded rate times the open days late,
 * capped at the replacement cost recorded for that item at checkout. The cap
 * wording appears only when the uncapped amount strictly exceeds the cost.
 */
function lateLineFor(item: FeeItem, openDaysLate: number, rules: FeeRules): FeeLine | null {
  if (openDaysLate <= 0) return null;
  const recordedCost = rules.replacement_costs_cents[String(item.id)] ?? 0;
  const uncapped = rules.late_fee_cents * openDaysLate;
  const capped = uncapped > recordedCost;
  const suffix = capped ? ', capped at replacement cost' : '';
  return {
    item_id: item.id,
    kind: 'late',
    open_days: openDaysLate,
    amount_cents: capped ? recordedCost : uncapped,
    description: `Late fee — ${item.name} (${item.tag}) — ${openDaysPhrase(openDaysLate)}${suffix}`,
  };
}

function damageLineFor(item: FeeItem, rules: FeeRules): FeeLine | null {
  if (item.grade !== 'damaged') return null;
  return {
    item_id: item.id,
    kind: 'damage',
    open_days: null,
    amount_cents: rules.damage_fee_cents,
    description: `Damage fee — ${item.name} (${item.tag})`,
  };
}

/** Lines per item, in the item order on the loan, late line before damage line. */
export function feeLinesFor(
  items: readonly FeeItem[],
  openDaysLate: number,
  rules: FeeRules,
): FeeLine[] {
  const lines: FeeLine[] = [];
  for (const item of items) {
    const late = lateLineFor(item, openDaysLate, rules);
    if (late) lines.push(late);
    const damage = damageLineFor(item, rules);
    if (damage) lines.push(damage);
  }
  return lines;
}

export function totalCents(lines: readonly FeeLine[]): number {
  return lines.reduce((sum, line) => sum + line.amount_cents, 0);
}

/** The late lines alone, which is what an out loan's overdue figure reports. */
export function lateFeeSoFarCents(
  items: readonly FeeItem[],
  openDaysLate: number,
  rules: FeeRules,
): number {
  return items.reduce((sum, item) => {
    const line = lateLineFor(item, openDaysLate, rules);
    return sum + (line ? line.amount_cents : 0);
  }, 0);
}

// Fee rules a loan records at checkout, its fee lines, the per-item cap and the overdue figures.
import { openDaysLate, type Calendar, type Settings } from "./calendar.js";

export interface FeeRules {
  late_fee_cents: number;
  damage_fee_cents: number;
  replacement_costs_cents: Record<string, number>;
}

export type Grade = "good" | "worn" | "damaged";

export interface FeeLine {
  item_id: number;
  kind: "late" | "damage";
  open_days: number | null;
  amount_cents: number;
  description: string;
}

interface LoanItemForFees {
  id: number;
  name: string;
  tag: string;
}

/** The rules in force at the moment a checkout succeeds: current settings and each item's current cost. */
export function recordFeeRules(settings: Settings, items: ReadonlyArray<{ id: number; replacement_cost_cents: number }>): FeeRules {
  const costs: Record<string, number> = {};
  for (const item of items) costs[String(item.id)] = item.replacement_cost_cents;
  return { late_fee_cents: settings.late_fee_cents, damage_fee_cents: settings.damage_fee_cents, replacement_costs_cents: costs };
}

/** Late amount for one item: the recorded rate times the open days, capped at its recorded replacement cost only when strictly over it. */
function lateAmount(rules: FeeRules, itemId: number, openDays: number): { amount: number; capped: boolean } {
  const uncapped = rules.late_fee_cents * openDays;
  const cost = rules.replacement_costs_cents[String(itemId)]!;
  return uncapped > cost ? { amount: cost, capped: true } : { amount: uncapped, capped: false };
}

export function lateFeeSoFar(rules: FeeRules, itemIds: readonly number[], openDays: number): number {
  return itemIds.reduce((sum, id) => sum + lateAmount(rules, id, openDays).amount, 0);
}

export function feeLines(
  rules: FeeRules,
  items: ReadonlyArray<LoanItemForFees & { grade: Grade }>,
  openDays: number,
): FeeLine[] {
  const lines: FeeLine[] = [];
  for (const item of items) {
    if (openDays > 0) {
      const { amount, capped } = lateAmount(rules, item.id, openDays);
      const days = openDays === 1 ? "1 open day late" : `${openDays} open days late`;
      lines.push({
        item_id: item.id,
        kind: "late",
        open_days: openDays,
        amount_cents: amount,
        description: `Late fee — ${item.name} (${item.tag}) — ${days}${capped ? ", capped at replacement cost" : ""}`,
      });
    }
    if (item.grade === "damaged") {
      lines.push({
        item_id: item.id,
        kind: "damage",
        open_days: null,
        amount_cents: rules.damage_fee_cents,
        description: `Damage fee — ${item.name} (${item.tag})`,
      });
    }
  }
  return lines;
}

interface OverdueSource {
  status: "reserved" | "out" | "pending-photo" | "returned-partial" | "returned-complete";
  due_date: string | null;
  fee_rules: FeeRules | null;
  recorded_open_days_late: number | null;
  recorded_late_fee_cents: number | null;
}

/** Open days late and late fee so far, decided only by the server's clock and the library calendar. */
export function overdueSoFar(
  loan: OverdueSource,
  itemIds: readonly number[],
  calendar: Calendar,
  now: number,
): { open_days_late: number | null; late_fee_so_far_cents: number | null } {
  if (loan.status === "reserved") return { open_days_late: null, late_fee_so_far_cents: null };
  if (loan.status === "out") {
    const days = openDaysLate(calendar, loan.due_date!, now);
    return { open_days_late: days, late_fee_so_far_cents: lateFeeSoFar(loan.fee_rules!, itemIds, days) };
  }
  return { open_days_late: loan.recorded_open_days_late, late_fee_so_far_cents: loan.recorded_late_fee_cents };
}

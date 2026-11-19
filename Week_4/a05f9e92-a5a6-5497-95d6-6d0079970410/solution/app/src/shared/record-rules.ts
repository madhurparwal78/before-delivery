import type { Value } from "./expression.js";
import type { Table } from "./types.js";

const MATRIX: Record<number, Record<number, number>> = {
  1: { 1: 1, 2: 2, 3: 3 },
  2: { 1: 2, 2: 3, 3: 4 },
  3: { 1: 3, 2: 4, 3: 5 },
};

/** The one decision of priority: the impact and urgency table, bumped one level for a business-critical item. */
export function derivePriority(impact: number, urgency: number, businessCritical: boolean): number {
  const base = MATRIX[impact]?.[urgency] ?? 5;
  return businessCritical ? Math.max(1, base - 1) : base;
}

/** The priority a change takes from its risk band; 5 before its first score and 1 for an emergency change. */
export function changePriority(model: string, band: "Low" | "Moderate" | "High" | null): number {
  if (model === "emergency") return 1;
  if (band === null) return 5;
  return band === "Low" ? 4 : band === "Moderate" ? 3 : 2;
}

/** The published starting values of a new record; every other field starts empty. */
export const PUBLISHED_DEFAULTS: Partial<Record<Table, Record<string, Value>>> = {
  incident: { impact: 2, urgency: 2, confidential: false, is_major: false, sla_breached: false },
  problem: { impact: 2, urgency: 2 },
  request_item: { impact: 3, urgency: 2, quantity: 1 },
  change: { model: "normal", backout_tested: false, priority: 5 },
};

/** The tables a person can start a record in, in the order of the New buttons; the operator alone creates changes. */
export const CREATABLE_TABLES: Table[] = ["incident", "problem", "task", "change"];

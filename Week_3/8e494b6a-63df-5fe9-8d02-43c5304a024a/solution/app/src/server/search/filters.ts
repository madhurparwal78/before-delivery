// Filter conditions {field, op, value}: filter pills, alert rule filters and objective bad-event filters share this.
import { parseIsoInstant } from "../../shared/time";
import { formatIso } from "../../shared/time";
import { isScalar, type Scalar } from "./fields";
import type { StoredEvent } from "./events";

export const FILTER_OPS = ["eq", "ne", "exists", "gt", "gte", "lt", "lte"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface Filter {
  field: string;
  op: FilterOp;
  value?: unknown;
}

export function eventValues(event: StoredEvent, field: string): Scalar[] {
  if (field === "@timestamp") return [formatIso(event.ts)];
  if (field === "_id") return [event.id];
  return event.flat.get(field) ?? [];
}

function equal(have: Scalar, want: unknown): boolean {
  if (typeof have === "number") return Number(want) === have && want !== "" && want !== null;
  if (typeof have === "boolean") return String(want) === String(have);
  const haveDate = parseIsoInstant(have);
  const wantDate = typeof want === "string" ? parseIsoInstant(want) : null;
  return haveDate !== null && wantDate !== null ? haveDate === wantDate : have === String(want);
}

function order(have: Scalar, want: unknown): number | null {
  if (typeof have === "number") {
    const target = Number(want);
    return Number.isNaN(target) ? null : have - target;
  }
  if (typeof have === "string") {
    const haveDate = parseIsoInstant(have);
    const wantDate = typeof want === "string" ? parseIsoInstant(want) : null;
    if (haveDate !== null && wantDate !== null) return haveDate - wantDate;
    return have < String(want) ? -1 : have > String(want) ? 1 : 0;
  }
  return null;
}

/** An include pill matches when any value equals; an exclude pill when none does; a missing field never equals. */
export function matchesFilter(event: StoredEvent, filter: Filter): boolean {
  const values = eventValues(event, filter.field);
  switch (filter.op) {
    case "exists":
      return values.length > 0;
    case "eq":
      return values.some((value) => equal(value, filter.value));
    case "ne":
      return !values.some((value) => equal(value, filter.value));
    default:
      return values.some((value) => {
        const difference = order(value, filter.value);
        if (difference === null) return false;
        return filter.op === "gt" ? difference > 0 : filter.op === "gte" ? difference >= 0 : filter.op === "lt" ? difference < 0 : difference <= 0;
      });
  }
}

export function parseFilters(raw: unknown): Filter[] | null {
  if (raw === undefined || raw === null || raw === "") return [];
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;
  const filters: Filter[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) return null;
    const { field, op, value } = item as Record<string, unknown>;
    if (typeof field !== "string" || !FILTER_OPS.includes(op as FilterOp)) return null;
    if (value !== undefined && !isScalar(value)) return null;
    filters.push({ field, op: op as FilterOp, value });
  }
  return filters;
}

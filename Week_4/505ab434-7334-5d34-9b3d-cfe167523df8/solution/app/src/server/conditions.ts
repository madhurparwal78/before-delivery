// The six condition kinds: validation of the typed value and the exact display text (brief: Business rules / Conditions).
import { ApiError } from "./errors.ts";
import { formatCalendarDate, isCalendarDate } from "../shared/dates.ts";
import type { ConditionKind } from "../shared/domain.ts";

const CLEAR_SPACE_VALUES = ["0.5", "1", "1.5", "2"] as const;

const invalid = (message: string): ApiError => new ApiError(422, "condition_invalid", message);

/** The value as stored (normalised) or a 422 `condition_invalid`. `none` kinds ignore the supplied value. */
export function normaliseCondition(kind: ConditionKind, value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  switch (kind) {
    case "clear_space": {
      const n = String(Number(raw));
      if (raw === "" || !(CLEAR_SPACE_VALUES as readonly string[]).includes(n)) throw invalid("Clear space must be 0.5, 1, 1.5 or 2.");
      return n;
    }
    case "attribution":
      if (raw === "") throw invalid("Attribution needs a credit line.");
      return raw;
    case "territory": {
      const codes = raw.split(/[\s,]+/).filter(Boolean).map((code) => code.toUpperCase());
      if (codes.length === 0) throw invalid("Territory needs at least one country code.");
      return codes.join(", ");
    }
    case "expiry_override":
      if (!isCalendarDate(raw)) throw invalid("Expiry override needs a date as YYYY-MM-DD.");
      return raw;
    case "no_recolour":
    case "proof_required":
      return null;
  }
}

/** Display text of a stored condition. */
export function conditionText(kind: ConditionKind, value: string | null): string {
  switch (kind) {
    case "clear_space":
      return `Keep clear space of ${value}x the symbol height on every side.`;
    case "no_recolour":
      return "Do not recolour the mark.";
    case "attribution":
      return `Credit line: ${value}`;
    case "proof_required":
      return "Upload final artwork for approval before use.";
    case "territory":
      return `Use only in: ${value}`;
    case "expiry_override":
      return `Use ends on ${formatCalendarDate(value!)}.`;
  }
}

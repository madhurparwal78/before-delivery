// Field validation rules. Every endpoint funnels through these decisions.

import {
  ROW_KEYS,
  SHARE_EVENT_KINDS,
  type ShareEventKind,
} from "./types.js";
import { Decimal } from "./decimal.js";

export function validateEthRow(value: string | null): string | null {
  if (value === null || value === "") return "Enter a value.";
  const d = Decimal.fromString(value);
  if (!d || d.isNegative()) return "Enter a non-negative amount.";
  const scale = d.scale;
  if (scale > 18) return "At most 18 fractional digits.";
  return null;
}

export function validateDilutedShares(value: string | null): string | null {
  if (value === null || value === "") return "Enter a value.";
  if (!/^\d+$/.test(value)) return "Enter a whole number of shares.";
  if (Decimal.fromString(value)?.isZero()) return "Shares must be positive.";
  return null;
}

export const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;

export function validateAccession(value: string | null): string | null {
  if (value === null || value === "") return "Enter the accession number.";
  if (!ACCESSION_PATTERN.test(value)) return "Use ten digits, a dash, two digits, a dash and six digits.";
  return null;
}

export function validateExhibitPage(value: number | null): string | null {
  if (value === null) return "Enter the exhibit page.";
  if (!Number.isInteger(value) || value < 1 || value > 500) return "Choose a page from 1 to 500.";
  return null;
}

export function validateCorrectionReason(value: string | null): string | null {
  if (value === null || value.trim() === "") return "Enter the correction reason.";
  if (value.length < 10 || value.length > 500) return "Use 10 to 500 characters.";
  return null;
}

export function validateNote(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return "Enter a note.";
  if (value.length < min || value.length > max) return `Use ${min} to ${max} characters.`;
  return null;
}

export interface ShareEventInput {
  kind: ShareEventKind;
  shares: string;
  effective_date: string;
}

export function validateShareEvent(
  ev: ShareEventInput,
  index: number,
  weekMonday: string,
  weekSunday: string,
): string[] {
  const fieldNames: string[] = [];
  if (!SHARE_EVENT_KINDS.includes(ev.kind)) fieldNames.push(`share_events.${index}.kind`);
  if (typeof ev.shares !== "string" || !/^\d+$/.test(ev.shares)) {
    fieldNames.push(`share_events.${index}.shares`);
  }
  if (typeof ev.effective_date !== "string" || ev.effective_date < weekMonday || ev.effective_date > weekSunday) {
    fieldNames.push(`share_events.${index}.effective_date`);
  }
  return fieldNames;
}

export const ROW_KEYS_SET = new Set<string>(ROW_KEYS);

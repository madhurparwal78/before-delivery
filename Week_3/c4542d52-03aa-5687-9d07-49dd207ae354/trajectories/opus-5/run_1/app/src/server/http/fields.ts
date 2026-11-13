import { parseDecimal } from "../domain/money.js";
import { parseYmd } from "../domain/dates.js";

export function bodyRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

export function field(body: unknown, name: string): unknown {
  return bodyRecord(body)[name];
}

export function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function readText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function readCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

export function readPrice(value: unknown): bigint | null {
  const parsed = parseDecimal(value, 4);
  return parsed === null || parsed <= 0n ? null : parsed;
}

export function readMoney(value: unknown): bigint | null {
  const parsed = parseDecimal(value, 2);
  return parsed === null || parsed <= 0n ? null : parsed;
}

export function readDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return parseYmd(value) === null ? null : value;
}

export function readInstant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

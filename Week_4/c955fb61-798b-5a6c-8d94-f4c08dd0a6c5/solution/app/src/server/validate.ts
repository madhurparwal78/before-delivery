import { isIsoDate, type IsoDate } from "../shared/calendar";
import { invalidField } from "./errors";

type Fields = Record<string, unknown>;

export function text(body: Fields, field: string, min: number, max: number): string {
  const value = body[field];
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length < min || trimmed.length > max) throw invalidField(field);
  return trimmed;
}

export function date(body: Fields, field: string): IsoDate {
  const value = body[field];
  if (!isIsoDate(value)) throw invalidField(field);
  return value;
}

export function whole(body: Fields, field: string, min: number, max: number): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw invalidField(field);
  return value;
}

export function oneOf<T extends string>(body: Fields, field: string, allowed: readonly T[]): T {
  const value = body[field];
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw invalidField(field);
  return found;
}

export function hours(body: Fields, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || value < 0.5 || value > 24 || !Number.isInteger(value * 2)) throw invalidField(field);
  return value;
}

export const has = (body: Fields, field: string): boolean => body[field] !== undefined;

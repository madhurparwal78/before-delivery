import type { Point } from '../shared/api';
import { copy } from '../shared/copy';
import { invalid } from './errors';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid('args', copy.history.invalidPoint);
  return value as Record<string, unknown>;
}

export function argsOf(value: unknown): Record<string, unknown> {
  return record(value);
}

export function readPoint(args: Record<string, unknown>, field: string): Point {
  const value = args[field];
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number' ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1])
  ) {
    invalid('args', copy.history.invalidPoint);
  }
  return [value[0] as number, value[1] as number];
}

export function readNumber(args: Record<string, unknown>, field: string): number {
  const value = args[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid('args', copy.properties.notANumber);
  return value;
}

export function readPositive(args: Record<string, unknown>, field: string): number {
  const value = readNumber(args, field);
  if (value <= 0) invalid('args', copy.history.positiveNumber);
  return value;
}

export function readNonNegative(args: Record<string, unknown>, field: string): number {
  const value = readNumber(args, field);
  if (value < 0) invalid('args', copy.history.positiveNumber);
  return value;
}

export function readInteger(args: Record<string, unknown>, field: string, minimum: number): number {
  const value = readNumber(args, field);
  if (!Number.isInteger(value) || value < minimum) invalid('args', copy.history.positiveNumber);
  return value;
}

export function readBoolean(args: Record<string, unknown>, field: string): boolean {
  return args[field] === true;
}

export function readText(args: Record<string, unknown>, field: string, maximum: number): string {
  const value = args[field];
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    invalid(field, `Enter 1 to ${maximum} characters.`);
  }
  return value as string;
}

export function readHandle(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== 'string' || value.length === 0) invalid('handles', copy.history.noObjectFound);
  return value as string;
}

export function readHandles(args: Record<string, unknown>, field: string): string[] {
  const value = args[field];
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string')) {
    invalid('handles', copy.history.noObjectFound);
  }
  return value as string[];
}

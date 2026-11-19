import { unprocessable } from './errors.js';
import type { Ctx } from './http.js';

export function fieldError(field: string, text: string): never {
  throw unprocessable({ [field]: text });
}

export function wholeNumber(ctx: Ctx, field: string, options: { min: number; max: number; text?: string }): number {
  const raw = ctx.body[field];
  const value = typeof raw === 'number' ? raw : Number(raw);
  const text =
    options.text ?? `Use ${ctx.num(options.min)} to ${ctx.num(options.max)}`;
  if (!Number.isInteger(value) || value < options.min || value > options.max) fieldError(field, text);
  return value;
}

export function optionalWholeNumber(
  ctx: Ctx,
  field: string,
  options: { min: number; max: number; text?: string; fallback: number },
): number {
  if (ctx.body[field] === undefined || ctx.body[field] === null) return options.fallback;
  return wholeNumber(ctx, field, options);
}

export function text(ctx: Ctx, field: string, options: { max?: number; label?: string } = {}): string {
  const raw = ctx.body[field];
  const value = typeof raw === 'string' ? raw.trim() : '';
  const label = options.label ?? 'Write something first';
  if (value === '') fieldError(field, label);
  if (options.max !== undefined && value.length > options.max) {
    fieldError(field, `Use at most ${ctx.num(options.max)} characters`);
  }
  return value;
}

export function choice<T extends string>(ctx: Ctx, field: string, allowed: readonly T[]): T {
  const raw = ctx.body[field];
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) {
    fieldError(field, `Choose ${allowed.join(' or ')}`);
  }
  return raw as T;
}

export function idParam(ctx: Ctx, name: string): number {
  const value = Number(ctx.params[name]);
  return Number.isInteger(value) ? value : -1;
}

export function flag(ctx: Ctx, field: string, fallback: boolean): boolean {
  const raw = ctx.body[field];
  return typeof raw === 'boolean' ? raw : fallback;
}

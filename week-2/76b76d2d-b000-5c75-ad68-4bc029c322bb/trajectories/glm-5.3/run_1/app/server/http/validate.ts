import type { Request } from 'express';
import type { Fare, Tier, Cadence, Locale } from '../domain/model';
import { isFare, isTier, isCadence, isLocale, isPurpose } from '../domain/model';
import { ApiError, validationError } from './errors';

type Json = Record<string, unknown>;

export function asObject(v: unknown): Json {
  return typeof v === 'object' && v !== null ? (v as Json) : {};
}

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function int(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number.parseInt(v, 10);
  return null;
}

export function bool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  return null;
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (v.length > 254) return null;
  return emailRe.test(v) ? v : null;
}

export interface LengthRule { min: number; max: number }

export function checkLength(value: string | null, field: string, rule: LengthRule, fields: Record<string, string>, locale: Locale): string | null {
  if (value === null || value.length < rule.min || value.length > rule.max) {
    fields[field] = locale === 'en'
      ? `Use ${rule.min} to ${rule.max} characters.`
      : `Utilisez de ${rule.min} à ${rule.max} caractères.`;
    return null;
  }
  return value;
}

export function requireString(value: unknown, field: string, fields: Record<string, string>, locale: Locale): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    fields[field] = locale === 'en' ? 'Required.' : 'Obligatoire.';
    return null;
  }
  return value;
}

export function emailField(value: unknown, field: string, fields: Record<string, string>, locale: Locale): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    fields[field] = locale === 'en' ? 'Required.' : 'Obligatoire.';
    return null;
  }
  if (!validEmail(value)) {
    fields[field] = locale === 'en' ? 'Enter a valid email address.' : 'Entrez une adresse courriel valide.';
    return null;
  }
  return value;
}

export function fareField(value: unknown, field: string, fields: Record<string, string>, locale: Locale): Fare | null {
  if (!isFare(value)) {
    fields[field] = locale === 'en' ? 'Choose one of the listed options.' : 'Choisissez l\'une des options proposées.';
    return null;
  }
  return value;
}

export function tierField(value: unknown, fields: Record<string, string>, locale: Locale): Tier | null {
  if (!isTier(value)) {
    fields.tier = locale === 'en' ? 'Choose one of the listed options.' : 'Choisissez l\'une des options proposées.';
    return null;
  }
  return value;
}

export function cadenceField(value: unknown, fields: Record<string, string>, locale: Locale): Cadence | null {
  if (!isCadence(value)) {
    fields.cadence = locale === 'en' ? 'Choose one of the listed options.' : 'Choisissez l\'une des options proposées.';
    return null;
  }
  return value;
}

export function localeField(value: unknown, field: string, fields: Record<string, string>, locale: Locale): Locale | null {
  if (!isLocale(value)) {
    fields[field] = locale === 'en' ? 'Choose one of the listed options.' : 'Choisissez l\'une des options proposées.';
    return null;
  }
  return value;
}

export function purposeField(value: unknown, fields: Record<string, string>, locale: Locale): 'checkout' | 'gift' | 'membership' | null {
  if (!isPurpose(value)) {
    fields.purpose = locale === 'en' ? 'Choose one of the listed options.' : 'Choisissez l\'une des options proposées.';
    return null;
  }
  return value;
}

export function throwValidation(fields: Record<string, string>): never {
  throw validationError(fields);
}

export function invalidJsonShape(): ApiError {
  return new ApiError('validation', { fields: {} });
}

export function requireIdempotencyKey(req: Request, fields: Record<string, string>, locale: Locale): string | null {
  const key = req.headers['idempotency-key'];
  const value = typeof key === 'string' ? key : null;
  if (value === null || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
    fields.idempotency_key = locale === 'en' ? 'A retry key is required.' : 'Une clé de reprise est requise.';
    return null;
  }
  return value;
}

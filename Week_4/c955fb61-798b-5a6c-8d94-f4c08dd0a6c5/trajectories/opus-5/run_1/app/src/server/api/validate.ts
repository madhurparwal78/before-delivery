import { isIsoDate } from '../../shared/dates.js';
import type { ItemKind, LinkType } from '../../shared/types.js';

export function isName(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= max;
}

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function isDate(value: unknown): value is string {
  return typeof value === 'string' && isIsoDate(value);
}

export function isKind(value: unknown): value is ItemKind {
  return value === 'task' || value === 'milestone' || value === 'group';
}

export function isLinkType(value: unknown): value is LinkType {
  return value === 'FS' || value === 'SS' || value === 'FF' || value === 'SF';
}

export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export function isHours(value: unknown): value is number {
  return typeof value === 'number' && value >= 0.5 && value <= 24 && Math.round(value * 2) === value * 2;
}

export function isPercent(value: unknown): value is number {
  return isInteger(value) && value >= 0 && value <= 100;
}

/** The project slug used in export filenames. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

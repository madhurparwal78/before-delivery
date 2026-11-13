import type { ParamSpec } from './scene';

export const MASS_UNITS: Record<string, number> = { kg: 1, g: 0.001, lb: 0.45359237 };
export const LENGTH_UNITS: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };
export const ANGLE_UNITS: Record<string, number> = { deg: 1, rad: 180 / Math.PI };

export type ParsedEntry = { value: number; unit: string } | { error: 'number' | 'unit' };

const NUMBER_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

export function unitsForGroup(group: ParamSpec['group']): Record<string, number> {
  if (group === 'mass') return MASS_UNITS;
  if (group === 'length') return LENGTH_UNITS;
  if (group === 'angle') return ANGLE_UNITS;
  return { '': 1 };
}

export function parseEntry(text: string, group: ParamSpec['group']): ParsedEntry {
  const trimmed = text.trim();
  const m = /^(-?(?:\d+(?:\.\d*)?|\.\d+))\s*([a-zA-Z]*)$/.exec(trimmed);
  if (!m) return { error: 'number' };
  const numText = m[1] ?? '';
  if (!NUMBER_RE.test(numText)) return { error: 'number' };
  const value = Number(numText);
  if (!Number.isFinite(value)) return { error: 'number' };
  const unit = (m[2] ?? '').toLowerCase();
  if (group === 'none') {
    if (unit === '') return { value, unit: '' };
    return { error: 'unit' };
  }
  const units = unitsForGroup(group);
  if (unit === '') return { value, unit: defaultUnit(group) };
  if (!(unit in units)) return { error: 'unit' };
  return { value: value * (units[unit] ?? 1), unit };
}

export function defaultUnit(group: ParamSpec['group']): string {
  if (group === 'mass') return 'kg';
  if (group === 'length') return 'm';
  if (group === 'angle') return 'deg';
  return '';
}

export function groupUnitErrorCopy(group: ParamSpec['group']): string {
  if (group === 'mass') return 'Use kg, g or lb.';
  if (group === 'length') return 'Use m, cm, mm, in or ft.';
  if (group === 'angle') return 'Use deg or rad.';
  return 'Enter a number.';
}

export function entryCopyFor(kind: ParamSpec['group'] | 'none', error: 'number' | 'unit'): string {
  if (error === 'number') return 'Enter a number.';
  return groupUnitErrorCopy(kind);
}

export function formatSi(value: number): string {
  let s = value.toFixed(6);
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  if (s === '-0') s = '0';
  return s;
}

export const UPLOAD_UNITS: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };

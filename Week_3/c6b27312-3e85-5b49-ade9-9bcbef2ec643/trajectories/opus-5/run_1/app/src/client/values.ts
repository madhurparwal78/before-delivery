import { ManifestEntry } from './api';
import { display, machineNumber, matchesNumberGrammar, roundTo, withUnit } from '../shared/numbers';
import { cmpText } from '../shared/order';

export type ParameterValue = number | boolean | string;
export type Values = Record<string, ParameterValue>;
export type Unit = 'mm' | 'in';

export const UNIT_KEY = 'tinework:units';

export function readUnit(): Unit {
  return localStorage.getItem(UNIT_KEY) === 'in' ? 'in' : 'mm';
}

export function writeUnit(unit: Unit): void {
  localStorage.setItem(UNIT_KEY, unit);
}

export function defaultsOf(manifest: ManifestEntry[]): Values {
  const values: Values = {};
  for (const entry of manifest) {
    if (!entry.derived) values[entry.name] = entry.default;
  }
  return values;
}

export function valueOf(entry: ManifestEntry, values: Values): ParameterValue {
  return Object.prototype.hasOwnProperty.call(values, entry.name) ? values[entry.name] : entry.default;
}

export function isModified(entry: ManifestEntry, values: Values): boolean {
  if (entry.derived) return false;
  return valueOf(entry, values) !== entry.default;
}

export function modifiedCount(manifest: ManifestEntry[], values: Values): number {
  return manifest.filter((entry) => isModified(entry, values)).length;
}

/** The shown number of a length: millimetres, or millimetres ÷ 25.4 under Inches. */
export function shownNumber(entry: ManifestEntry, value: number, unit: Unit): number {
  if (unit === 'in' && entry.kind === 'length') return value / 25.4;
  return value;
}

export function shownPrecision(entry: ManifestEntry, unit: Unit): number {
  return unit === 'in' && entry.kind === 'length' ? entry.precision + 1 : entry.precision;
}

export function fieldText(entry: ManifestEntry, value: number, unit: Unit): string {
  return display(shownNumber(entry, value, unit), shownPrecision(entry, unit));
}

const UNIT_WORDS: Record<string, string> = { mm: 'millimetres', in: 'inches', '°': 'degrees' };

export function unitWord(entry: ManifestEntry, unit: Unit): string {
  if (entry.kind === 'angle') return UNIT_WORDS['°'];
  return unit === 'in' ? UNIT_WORDS.in : UNIT_WORDS.mm;
}

export function unitMark(entry: ManifestEntry, unit: Unit): string {
  if (entry.kind === 'angle') return '°';
  if (entry.kind === 'count') return '';
  return unit === 'in' ? 'in' : 'mm';
}

/** `aria-valuetext` is the value at display precision with its unit word. */
export function valueText(entry: ManifestEntry, value: ParameterValue, unit: Unit): string {
  if (entry.kind === 'count') return display(Number(value), 0);
  if (entry.kind === 'boolean') return value === true ? 'on' : 'off';
  if (entry.kind === 'enum') return String(value);
  return `${fieldText(entry, Number(value), unit)} ${unitWord(entry, unit)}`;
}

/** The was marker's default, always in millimetres. */
export function wasMarker(entry: ManifestEntry): string {
  if (entry.kind === 'boolean') return `was ${entry.default === true ? 'on' : 'off'}`;
  if (entry.kind === 'enum') return `was ${String(entry.default)}`;
  if (entry.kind === 'count') return `was ${display(Number(entry.default), 0)}`;
  return `was ${withUnit(display(Number(entry.default), entry.precision), entry.unit ?? 'mm')}`;
}

export function derivedText(entry: ManifestEntry, value: ParameterValue): string {
  return `${entry.label} ${withUnit(display(Number(value), entry.precision), 'mm')}`;
}

/** A parameter change line: `<Label>: <before> → <after> <unit>`. */
export function parameterChangeLine(
  entry: { label: string; precision: number; unit: 'mm' | '°' | null; kind: ManifestEntry['kind'] },
  before: ParameterValue,
  after: ParameterValue,
): string {
  const render = (value: ParameterValue): string => {
    if (typeof value === 'boolean') return value ? 'on' : 'off';
    if (typeof value === 'string') return value;
    if (entry.kind === 'count') return display(value, 0);
    return display(value, entry.precision);
  };
  const tail = entry.unit === null || entry.kind === 'count' ? '' : ` ${entry.unit}`;
  return `${entry.label}: ${render(before)} → ${render(after)}${tail}`;
}

export function clampValue(entry: ManifestEntry, value: number): number {
  let next = value;
  if (entry.min !== undefined) next = Math.max(entry.min, next);
  if (entry.max !== undefined) next = Math.min(entry.max, next);
  return roundTo(next, 3);
}

/** Stepped values snap to whole multiples of one tenth of the step, worked in decimal. */
export function stepValue(entry: ManifestEntry, value: number, steps: number, fine: number): number {
  const step = entry.step ?? 1;
  const grain = entry.kind === 'count' ? 1 : Math.max(0.001, roundTo(step / 10, 3));
  const delta = entry.kind === 'count' ? steps : steps * step * fine;
  const raw = roundTo(value + delta, 3);
  const snapped = Math.round(raw / grain) * grain;
  return clampValue(entry, roundTo(snapped, 3));
}

export type StepModifiers = { fine: boolean; coarse: boolean };

export function stepsFor(entry: ManifestEntry, modifiers: StepModifiers): { steps: number; fine: number } {
  if (entry.kind === 'count') return { steps: modifiers.coarse ? 10 : 1, fine: 1 };
  if (modifiers.coarse) return { steps: 10, fine: 1 };
  if (modifiers.fine) return { steps: 1, fine: 0.1 };
  return { steps: 1, fine: 1 };
}

/** A typed inch value is multiplied by 25.4, kept to at most 3 decimals. */
export function typedToMillimetres(entry: ManifestEntry, typed: number, unit: Unit): number {
  if (unit === 'in' && entry.kind === 'length') return roundTo(typed * 25.4, 3);
  return roundTo(typed, 3);
}

export function configString(manifest: ManifestEntry[], values: Values): string {
  const pairs: string[] = [];
  for (const entry of manifest) {
    if (entry.derived) continue;
    const value = valueOf(entry, values);
    if (value === entry.default) continue;
    const text =
      typeof value === 'number' ? machineNumber(value) : typeof value === 'boolean' ? String(value) : value;
    pairs.push(`${entry.name}=${text}`);
  }
  pairs.sort((a, b) => cmpText(a.slice(0, a.indexOf('=')), b.slice(0, b.indexOf('='))));
  return pairs.join(',');
}

export type ParsedConfig = { values: Values; dropped: string[] };

/** Unknown names and unusable values are dropped and named in the dropped-link option. */
export function parseConfig(text: string, manifest: ManifestEntry[]): ParsedConfig {
  const values: Values = {};
  const dropped: string[] = [];
  if (text.length === 0) return { values, dropped };
  for (const pair of text.split(',')) {
    if (pair.length === 0) continue;
    const index = pair.indexOf('=');
    const name = index === -1 ? pair : pair.slice(0, index);
    const raw = index === -1 ? '' : pair.slice(index + 1);
    const entry = manifest.find((candidate) => candidate.name === name);
    if (!entry || entry.derived) {
      dropped.push(name);
      continue;
    }
    if (entry.kind === 'boolean') {
      if (raw === 'true' || raw === 'false') values[name] = raw === 'true';
      else dropped.push(name);
      continue;
    }
    if (entry.kind === 'enum') {
      if (entry.options?.includes(raw)) values[name] = raw;
      else dropped.push(name);
      continue;
    }
    if (!matchesNumberGrammar(raw)) {
      dropped.push(name);
      continue;
    }
    const value = Number(raw);
    if (entry.kind === 'count' && !Number.isInteger(value)) {
      dropped.push(name);
      continue;
    }
    if (
      (entry.min !== undefined && value < entry.min) ||
      (entry.max !== undefined && value > entry.max)
    ) {
      dropped.push(name);
      continue;
    }
    values[name] = value === 0 ? 0 : value;
  }
  return { values, dropped };
}

/** The values a save sends: only those that differ from the source defaults. */
export function sparseValues(manifest: ManifestEntry[], values: Values): Values {
  const sparse: Values = {};
  for (const entry of manifest) {
    if (entry.derived) continue;
    const value = valueOf(entry, values);
    if (value !== entry.default) sparse[entry.name] = value;
  }
  return sparse;
}

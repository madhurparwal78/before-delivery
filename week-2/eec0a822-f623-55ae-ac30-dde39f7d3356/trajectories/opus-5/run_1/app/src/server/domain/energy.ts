import { FIELD_ERRORS } from '../../shared/copy.js';
import { localDate } from '../../shared/zone.js';
import { validation } from '../http/errors.js';

export interface EnergyDay {
  readonly date: string;
  readonly startChargePct: number;
  readonly endChargePct: number;
  readonly lowestChargePct: number;
  readonly solarWh: number;
}

interface LogEntry {
  readonly at: Date;
  readonly chargePct: number;
  readonly solarWh: number;
}

function isInstantString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value);
}

/** Parses a daily log into per-day figures, refusing the first line that is not an entry. */
export function parseEnergyLog(content: Buffer, zone: string): EnergyDay[] {
  const lines = content.toString('utf8').split('\n');
  const entries: LogEntry[] = [];
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '') continue;
    const entry = parseLine(line);
    if (entry === null) throw validation({ log: FIELD_ERRORS.logLine(index + 1) });
    entries.push(entry);
  }
  if (entries.length === 0) throw validation({ log: FIELD_ERRORS.emptyLog });
  return groupByDay(entries, zone);
}

function parseLine(line: string): LogEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const { at, chargePct, solarWh, packKw } = record;
  if (!isInstantString(at)) return null;
  if (typeof chargePct !== 'number' || !Number.isFinite(chargePct) || chargePct < 0 || chargePct > 100) {
    return null;
  }
  if (typeof solarWh !== 'number' || !Number.isInteger(solarWh) || solarWh < 0) return null;
  if (typeof packKw !== 'number' || !Number.isFinite(packKw)) return null;
  return { at: new Date(at), chargePct, solarWh };
}

function groupByDay(entries: readonly LogEntry[], zone: string): EnergyDay[] {
  const byDate = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    const date = localDate(zone, entry.at);
    const bucket = byDate.get(date);
    if (bucket === undefined) byDate.set(date, [entry]);
    else bucket.push(entry);
  }
  const days: EnergyDay[] = [];
  for (const [date, bucket] of [...byDate.entries()].sort((left, right) =>
    left[0] < right[0] ? -1 : 1,
  )) {
    const ordered = [...bucket].sort((left, right) => left.at.getTime() - right.at.getTime());
    days.push({
      date,
      startChargePct: ordered[0].chargePct,
      endChargePct: ordered[ordered.length - 1].chargePct,
      lowestChargePct: ordered.reduce((lowest, entry) => Math.min(lowest, entry.chargePct), 100),
      solarWh: ordered.reduce((total, entry) => total + entry.solarWh, 0),
    });
  }
  return days;
}

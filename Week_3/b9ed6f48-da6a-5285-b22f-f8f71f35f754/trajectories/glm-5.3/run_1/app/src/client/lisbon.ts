/**
 * Lisbon wall-clock conversion in the browser: an entry typed as
 * "YYYY-MM-DD HH:MM:SS" is always read as Lisbon time, whatever the device zone,
 * and sent with the offset Lisbon has at that wall time. A skipped hour is
 * refused so nothing is sent.
 */

export interface LisbonResult {
  kind: 'ok';
  iso: string;
  ms: number;
}

function lastSundayOfMonth(year: number, month: number): number {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const d = new Date(Date.UTC(year, month - 1, daysInMonth));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getUTCDate();
}

function transitions(year: number): { forwardMs: number; backMs: number } {
  const marchSunday = lastSundayOfMonth(year, 3);
  const octoberSunday = lastSundayOfMonth(year, 10);
  return {
    forwardMs: Date.UTC(year, 2, marchSunday, 1, 0, 0),
    backMs: Date.UTC(year, 9, octoberSunday, 1, 0, 0),
  };
}

function offsetAt(ms: number): number {
  const year = new Date(ms).getUTCFullYear();
  const { forwardMs, backMs } = transitions(year);
  return ms >= forwardMs && ms < backMs ? 60 : 0;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toOffsetIso(ms: number): string;
export function toOffsetIso(entry: string): string | null;
export function toOffsetIso(value: number | string): string | null {
  let ms: number;
  if (typeof value === 'number') {
    ms = value;
  } else {
    const text = value.trim();
    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = m[6] ? Number(m[6]) : 0;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    const result = wallToInstant(year, month, day, hour, minute, second);
    if (result === null) return null;
    ms = result;
  }
  const off = offsetAt(ms);
  const d = new Date(ms + off * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${off === 60 ? '+01:00' : '+00:00'}`;
}

function wallToInstant(year: number, month: number, day: number, hour: number, minute: number, second: number): number | null {
  const { forwardMs, backMs } = transitions(year);
  const naiveWinter = Date.UTC(year, month - 1, day, hour, minute, second);
  const naiveSummer = naiveWinter - 3_600_000;
  // Wall times 01:00-01:59 on the spring-forward day do not exist.
  if (naiveWinter >= forwardMs && naiveWinter < forwardMs + 3_600_000) return null;
  // Summer instants, and the first occurrence of the repeated autumn hour.
  if (naiveSummer >= forwardMs && naiveSummer < backMs) return naiveSummer;
  return naiveWinter;
}

export function isSkippedLisbonTime(text: string): boolean {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return false;
  return wallToInstant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), m[6] ? Number(m[6]) : 0) === null;
}

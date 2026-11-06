/**
 * Timestamps. One place owns the API format: YYYY-MM-DDTHH:MM:SSZ.
 */

const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export type ParsedTs = { year: number; month: number; day: number; hour: number; minute: number; second: number }

export function isApiTimestamp(value: unknown): value is string {
  return typeof value === 'string' && TS_RE.test(value)
}

export function parseApiTimestamp(value: string): ParsedTs | null {
  const m = TS_RE.exec(value)
  if (!m) return null
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour > 23 || minute > 59 || second > 59) return null
  return { year, month, day, hour, minute, second }
}

export function isHalfHourTs(value: string): boolean {
  const p = parseApiTimestamp(value)
  if (!p) return false
  return p.second === 0 && (p.minute === 0 || p.minute === 30)
}

export function isUtcDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value)
}

export function dateWithin(value: string): boolean {
  const p = parseApiTimestamp(`${value}T00:00:00Z`)
  return p !== null
}

const TWO = (n: number) => String(n).padStart(2, '0')

/** Convert a Date to the API timestamp form (UTC, whole seconds). */
export function apiTimestamp(d: Date): string {
  return `${d.getUTCFullYear()}-${TWO(d.getUTCMonth() + 1)}-${TWO(d.getUTCDate())}T${TWO(d.getUTCHours())}:${TWO(d.getUTCMinutes())}:${TWO(d.getUTCSeconds())}Z`
}

/** Convert a Date to the API timestamp form truncated to whole seconds. */
export function apiTimestampTrunc(d: Date): string {
  const ms = Math.floor(d.getTime() / 1000) * 1000
  return apiTimestamp(new Date(ms))
}

/** UTC date form YYYY-MM-DD from a Date. */
export function utcDate(d: Date): string {
  return `${d.getUTCFullYear()}-${TWO(d.getUTCMonth() + 1)}-${TWO(d.getUTCDate())}`
}

/** Index of half-hour since epoch, negative allowed. */
export function halfHourIndex(ts: string): number {
  const d = new Date(ts)
  return Math.floor(d.getTime() / 1800000)
}

/** API timestamp from half-hour index. */
export function fromHalfHourIndex(idx: number): string {
  return apiTimestamp(new Date(idx * 1800000))
}

/** The half-hour index of the UTC day containing a timestamp. */
export function dayIndex(ts: string): number {
  return Math.floor(new Date(ts).getTime() / 86400000)
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return utcDate(d)
}

export function utcDateStamp(idx: number): string {
  return utcDate(new Date(idx * 86400000))
}

/** <start display> form: YYYY-MM-DD HH:MM UTC */
export function displayInterval(ts: string): string {
  return `${ts.slice(0, 10)} ${ts.slice(11, 16)} UTC`
}

/** <checked display> form: YYYY-MM-DD HH:MM:SS UTC */
export function displayChecked(ts: string): string {
  return `${ts.slice(0, 10)} ${ts.slice(11, 19)} UTC`
}

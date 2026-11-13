export const DAY_MS = 86400000

export const parseDay = (iso: string): number => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))

export const formatDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export const addDays = (iso: string, n: number): string => formatDay(parseDay(iso) + n * DAY_MS)

export const daysBetween = (from: string, to: string): number => Math.round((parseDay(to) - parseDay(from)) / DAY_MS)

export const isoWeekday = (iso: string): number => ((new Date(parseDay(iso)).getUTCDay() + 6) % 7) + 1

export const isRealDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return formatDay(parseDay(value)) === value
}

export function span(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day < to; day = addDays(day, 1)) days.push(day)
  return days
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function wallFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
    formatters.set(zone, formatter)
  }
  return formatter
}

function wallMinutes(instant: number, zone: string): number {
  const parts: Record<string, number> = {}
  for (const part of wallFormatter(zone).formatToParts(new Date(instant))) if (part.type !== 'literal') parts[part.type] = Number(part.value)
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) / 60000
}

export function localDate(instant: Date, zone: string): string {
  return formatDay(wallMinutes(instant.getTime(), zone) * 60000)
}

export function localWall(instant: Date, zone: string): string {
  const minutes = wallMinutes(instant.getTime(), zone)
  return new Date(minutes * 60000).toISOString().slice(0, 16)
}

/** The instant at which `hour:00` wall-clock time on `day` happens in `zone`; a skipped time moves forward to the first valid minute, a repeated time uses its first occurrence. */
export function localMoment(day: string, hour: number, zone: string): Date {
  const wall = parseDay(day) / 60000 + hour * 60
  const offsetAt = (instant: number): number => wallMinutes(instant, zone) - instant / 60000
  const before = offsetAt((wall - 36 * 60) * 60000)
  const after = offsetAt((wall + 36 * 60) * 60000)
  const candidates = [wall - before, wall - after].filter((minute) => wallMinutes(minute * 60000, zone) === wall)
  if (candidates.length) return new Date(Math.min(...candidates) * 60000)
  let low = Math.min(wall - before, wall - after)
  let high = Math.max(wall - before, wall - after)
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2)
    if (wallMinutes(mid * 60000, zone) >= wall) high = mid
    else low = mid
  }
  return new Date(high * 60000)
}

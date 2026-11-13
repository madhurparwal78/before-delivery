const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const ZONES = new Set<string>([...Intl.supportedValuesOf('timeZone'), 'UTC'])

export function timeZoneNames(): string[] {
  return [...ZONES].sort()
}

export function isTimeZone(value: unknown): value is string {
  return typeof value === 'string' && ZONES.has(value)
}

/** Today's calendar date as YYYY-MM-DD in a time zone. */
export function todayIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

/** A link works through the end of its date in the hiker's current time zone. */
export function isShareExpired(expiresOn: string | null, timeZone: string, now: Date): boolean {
  return expiresOn !== null && todayIn(timeZone, now) > expiresOn
}

export function expiredNotice(expiresOn: string): string {
  return `This link expired on ${expiresOn}. Create a new link to share again.`
}

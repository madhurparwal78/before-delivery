// Wall-time handling in the class's own zone (DP-26). The server runs in UTC
// but decides every class time in the class zone. IANA lookups come from the
// platform time zone data through Intl, which ships with Node.

export function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

const ZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'America/Phoenix', 'America/Toronto', 'America/Mexico_City',
  'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'America/Lima', 'America/Bogota',
  'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Paris',
  'Europe/Brussels', 'Europe/Amsterdam', 'Europe/Berlin', 'Europe/Zurich', 'Europe/Rome',
  'Europe/Stockholm', 'Europe/Oslo', 'Europe/Copenhagen', 'Europe/Warsaw', 'Europe/Prague',
  'Europe/Vienna', 'Europe/Budapest', 'Europe/Athens', 'Europe/Helsinki', 'Europe/Kiev',
  'Europe/Istanbul', 'Europe/Moscow', 'Africa/Casablanca', 'Africa/Lagos', 'Africa/Cairo',
  'Africa/Nairobi', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Tehran', 'Asia/Karachi',
  'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong',
  'Asia/Shanghai', 'Asia/Taipei', 'Asia/Seoul', 'Asia/Tokyo', 'Australia/Perth',
  'Australia/Adelaide', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane',
  'Pacific/Auckland', 'Pacific/Fiji'
]

export function zoneOptions(): string[] {
  return ZONES
}

/** Turns a local wall time in a zone into its UTC instant. */
export function localToUtc(
  zone: string,
  year: number, month: number, day: number,
  hour: number, minute: number, second: number
): { at: Date | null; skipped: boolean } {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second)
  for (const offsetHours of candidateOffsets(zone, new Date(naive))) {
    const at = new Date(naive - offsetHours * 3600000)
    if (wallTimeMatches(zone, at, year, month, day, hour, minute, second)) {
      return { at, skipped: false }
    }
  }
  // The time may happen twice; the first occurrence wins. Otherwise it was
  // skipped by a daylight-saving change.
  const hourBefore = new Date(naive - 3600000)
  const offsetBefore = zoneOffsetMinutes(zone, hourBefore)
  const at = new Date(naive - offsetBefore * 60000)
  if (wallTimeMatches(zone, at, year, month, day, hour, minute, second)) {
    return { at, skipped: false }
  }
  return { at: null, skipped: true }
}

function zoneOffsetMinutes(zone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
  const parts = formatter.formatToParts(at)
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type)
    if (!part) return 0
    const value = Number(part.value)
    if (type === 'hour' && value === 24) return 0
    return value
  }
  const asUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour'), get('minute'), get('second')
  )
  return Math.round((asUtc - at.getTime()) / 60000)
}

function wallTimeMatches(
  zone: string, at: Date,
  year: number, month: number, day: number,
  hour: number, minute: number, second: number
): boolean {
  const offset = zoneOffsetMinutes(zone, at)
  const shifted = new Date(at.getTime() + offset * 60000)
  return shifted.getUTCFullYear() === year && shifted.getUTCMonth() === month - 1 &&
    shifted.getUTCDate() === day && shifted.getUTCHours() === hour &&
    shifted.getUTCMinutes() === minute && shifted.getUTCSeconds() === second
}

function candidateOffsets(zone: string, around: Date): number[] {
  const set = new Set<number>()
  for (const delta of [-86400000, -3600000, 0, 3600000, 86400000]) {
    set.add(zoneOffsetMinutes(zone, new Date(around.getTime() + delta)) / 60)
  }
  return [...set]
}

/** Formats an instant as a local wall time with seconds in the class zone. */
export function utcToWallString(zone: string, at: Date): string {
  const offset = zoneOffsetMinutes(zone, at)
  const shifted = new Date(at.getTime() + offset * 60000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
}

export function utcToWallMinute(zone: string, at: Date): string {
  return utcToWallString(zone, at).slice(0, 16)
}

export function wallParts(wall: string): {
  year: number, month: number, day: number, hour: number, minute: number, second: number
} | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(wall.trim())
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  const parts = {
    year: Number(year), month: Number(month), day: Number(day),
    hour: Number(hour), minute: Number(minute), second: Number(second ?? '0')
  }
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null
  if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null
  return parts
}

export function clockTimeString(at: Date): string {
  return utcToWallString('UTC', at).slice(11, 19)
}

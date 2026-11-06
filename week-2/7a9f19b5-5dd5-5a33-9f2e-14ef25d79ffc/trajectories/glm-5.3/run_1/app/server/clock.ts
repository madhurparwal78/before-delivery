/**
 * Clock helpers. The server's date for every date rule is the current date
 * in Pacific/Auckland, or LIGHTFALL_TODAY when set.
 */
import { config } from './db.js'

export function server_today(): string {
  const today = config().lightfall_today
  if (today) return today
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date())
  return parts
}

export function server_year_month(): { year: number; month: number } {
  const today = server_today()
  const [year, month] = today.split('-').map(Number)
  return { year: year!, month: month!! }
}

/** Current year and month in Pacific/Auckland, for card expiry. */
export function current_expiry(): { year: number; month: number } {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date())
  const [year, month] = iso.split('-').map(Number)
  return { year: year!, month: month! }
}

/** Display formats from Feedback states. */

import { Decimal } from 'decimal.js'

/** <signed tonnes>: leading '+' when positive, '-' when negative, no sign for zero. */
export function signedTonnes(value: string): string {
  if (value.startsWith('-')) return value
  if (new Decimal(value).isZero()) return value
  return `+${value}`
}

/** <start display>/<end display>: YYYY-MM-DD HH:MM UTC. */
export function displayInterval(ts: string): string {
  return `${ts.slice(0, 10)} ${ts.slice(11, 16)} UTC`
}

/** <checked display>: YYYY-MM-DD HH:MM:SS UTC. */
export function displayChecked(ts: string): string {
  return `${ts.slice(0, 10)} ${ts.slice(11, 19)} UTC`
}

/** <expires display>: YYYY-MM-DD HH:MM UTC. */
export function displayExpiry(ts: string): string {
  return `${ts.slice(0, 10)} ${ts.slice(11, 16)} UTC`
}

export function compactStamp(ts: string): string {
  return ts.replaceAll('-', '').replace('T', '').replace(':', '').slice(0, 12)
}

export function fromCompactStamp(stamp: string): string {
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:00Z`
}

export function halfHourIndex(ts: string): number {
  return Math.floor(new Date(ts).getTime() / 1800000)
}

export function fromHalfHourIndex(idx: number): string {
  return new Date(idx * 1800000).toISOString().replace('.000Z', 'Z')
}

export function utcDayOf(ts: string): string {
  return ts.slice(0, 10)
}

export function dateOnly(ts: string): string {
  return ts.slice(0, 10)
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

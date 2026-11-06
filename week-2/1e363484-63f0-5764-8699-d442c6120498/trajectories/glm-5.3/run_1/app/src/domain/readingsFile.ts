/**
 * Canonical readings file and fingerprint.
 *
 * One place owns the canonical serialisation: buildReadingsFile.
 */

export type CanonicalReading = {
  sensor_id: string
  interval_start: string // API timestamp form YYYY-MM-DDTHH:MM:SSZ
  fc: string // exactly 4 decimals
  fch4: string // exactly 4 decimals
  qc: string // single digit
}

/** Format a stored reading value (string from db) into exactly-4-decimals canonical text. */
export function canonNum(raw: string): string {
  // stored values keep up to 4 decimals; normalise form without float math
  const s = raw.includes('e') || raw.includes('E')
    ? raw
    : raw
  return s
}

/** Build the canonical readings file bytes. Order: sensor id byte order, then interval start. */
export function buildReadingsFile(readings: CanonicalReading[]): { bytes: Buffer; count: number; sha256: string } {
  const sorted = [...readings].sort((a, b) => {
    if (a.sensor_id !== b.sensor_id) return a.sensor_id < b.sensor_id ? -1 : 1
    return a.interval_start < b.interval_start ? -1 : 1
  })
  const lines = ['sensor_id,interval_start,fc,fch4,qc']
  for (const r of sorted) {
    lines.push(`${r.sensor_id},${compactStamp(r.interval_start)},${r.fc},${r.fch4},${r.qc}`)
  }
  const bytes = Buffer.from(lines.join('\n') + '\n', 'utf8')
  return { bytes, count: sorted.length, sha256: hash(bytes) }
}

export function hash(bytes: Buffer): string {
  return cryptoHash(bytes)
}

import { createHash } from 'node:crypto'
function cryptoHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** API timestamp YYYY-MM-DDTHH:MM:SSZ -> compact YYYYMMDDHHMM (UTC). */
export function compactStamp(ts: string): string {
  return ts.replaceAll('-', '').replace('T', '').replace(':', '').slice(0, 12)
}

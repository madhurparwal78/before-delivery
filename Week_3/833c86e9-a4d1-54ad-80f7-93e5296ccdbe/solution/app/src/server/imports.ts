import { createHash } from 'node:crypto'
import { addDays, isoWeekday, isRealDay } from '../shared/dates'
import { rows, type Db } from './db'

interface ImportLine { line: number; key: string; params: Record<string, string | number> }
interface ImportEntry { line: number; room: string; from: string; to: string; weekdays: boolean[]; rate: number; min: number | null; max: number | null }

const LETTERS = 'MTWTFSS'

function parseLine(text: string, line: number, roomCodes: Set<string>): ImportEntry | ImportLine {
  const fields = text.split('|')
  const error = (key: string, params: Record<string, string | number> = {}): ImportLine => ({ line, key: `import.${key}`, params: { n: line, ...params } })
  if (fields.length !== 8) return error('fields', { m: fields.length })
  const [room, plan, from, to, weekdays, rate, min, max] = fields
  if (!roomCodes.has(room)) return error('room', { x: room })
  if (plan !== 'refundable') return error('plan', { x: plan })
  if (!isRealDay(from)) return error('date', { x: from })
  if (!isRealDay(to)) return error('date', { x: to })
  if (from > to) return error('order', { from, to })
  if (weekdays.length !== 7 || [...weekdays].some((ch, i) => ch !== LETTERS[i] && ch !== '-')) return error('weekdays', { x: weekdays })
  if (!/^[1-9]\d*$/.test(rate)) return error('rate')
  const limit = (value: string): number | null | undefined => (value === '' ? null : /^[1-9]\d*$/.test(value) ? Number(value) : undefined)
  const low = limit(min)
  const high = limit(max)
  if (low === undefined || high === undefined || (low !== null && high !== null && high < low)) return error('limits', { x: `${min}|${max}` })
  return { line, room, from, to, weekdays: [...weekdays].map((ch) => ch !== '-'), rate: Number(rate), min: low, max: high }
}

const shares = (a: ImportEntry, b: ImportEntry): boolean => {
  if (a.room !== b.room) return false
  const from = a.from > b.from ? a.from : b.from
  const to = a.to < b.to ? a.to : b.to
  for (let day = from; day <= to; day = addDays(day, 1)) if (a.weekdays[isoWeekday(day) - 1] && b.weekdays[isoWeekday(day) - 1]) return true
  return false
}

export function parseImport(bytes: Buffer, roomCodes: Set<string>): { errors: ImportLine[]; entries: ImportEntry[] } {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { errors: [{ line: 1, key: 'import.header', params: { n: 1 } }], entries: [] }
  }
  const lines = text.split(/\r?\n/)
  if (lines[0] !== 'KIPRATES 1') return { errors: [{ line: 1, key: 'import.header', params: { n: 1 } }], entries: [] }
  const errors: ImportLine[] = []
  const entries: ImportEntry[] = []
  lines.forEach((raw, index) => {
    if (index === 0 || raw.trim() === '' || raw.startsWith('#')) return
    const parsed = parseLine(raw, index + 1, roomCodes)
    if ('key' in parsed) errors.push(parsed)
    else {
      const earlier = entries.find((entry) => shares(entry, parsed))
      if (earlier) errors.push({ line: parsed.line, key: 'import.overlap', params: { n: parsed.line, m: earlier.line } })
      entries.push(parsed)
    }
  })
  return { errors, entries }
}

export const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

interface NightChange { room: string; date: string; old_minor: number; new_minor: number; min: number | null; max: number | null }

/** One row per night whose rate, minimum or maximum would change, ordered by room then date. */
export async function planChanges(db: Db, entries: ImportEntry[]): Promise<NightChange[]> {
  const changes: NightChange[] = []
  for (const entry of entries) {
    const existing = new Map((await rows<{ date: string; rate_minor: number; min_stay: number; max_stay: number }>(
      db, `SELECT date, rate_minor, min_stay, max_stay FROM nights WHERE room_type = $1 AND date BETWEEN $2 AND $3`, [entry.room, entry.from, entry.to])).map((row) => [row.date, row]))
    for (let day = entry.from; day <= entry.to; day = addDays(day, 1)) {
      if (!entry.weekdays[isoWeekday(day) - 1]) continue
      const old = existing.get(day)
      const oldRate = old?.rate_minor ?? 0
      const differs = !old || oldRate !== entry.rate || (entry.min !== null && entry.min !== old.min_stay) || (entry.max !== null && entry.max !== old.max_stay)
      if (differs) changes.push({ room: entry.room, date: day, old_minor: oldRate, new_minor: entry.rate, min: entry.min, max: entry.max })
    }
  }
  return changes.sort((a, b) => (a.room === b.room ? (a.date < b.date ? -1 : 1) : a.room < b.room ? -1 : 1))
}

export async function applyChanges(db: Db, changes: NightChange[]): Promise<void> {
  for (const change of changes) {
    await db.query(
      `INSERT INTO nights (room_type, date, rate_minor, allotment, min_stay, max_stay, closed_to_arrival, closed_to_departure, stop_sell, release_days)
       SELECT r.code, $2::date, $3, r.rooms, COALESCE($4, 1), COALESCE($5, 30), false, false, false, 0 FROM room_types r WHERE r.code = $1
       ON CONFLICT (room_type, date) DO UPDATE SET rate_minor = EXCLUDED.rate_minor,
         min_stay = COALESCE($4, nights.min_stay), max_stay = COALESCE($5, nights.max_stay)`,
      [change.room, change.date, change.new_minor, change.min, change.max],
    )
  }
}


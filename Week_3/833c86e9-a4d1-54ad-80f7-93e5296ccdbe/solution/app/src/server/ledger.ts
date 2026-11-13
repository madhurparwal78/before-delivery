import type { LedgerEntry } from '../shared/types'
import { one, rows, type Db } from './db'

/** One money movement is one pair of entries with the same pair number; entries are never edited or deleted. */
export async function recordPair(db: Db, booking: string, kind: LedgerEntry['kind'], debit: LedgerEntry['account'], credit: LedgerEntry['account'], amount: number, at: Date): Promise<void> {
  const last = await one<{ pair: number | null }>(db, `SELECT max(pair)::int AS pair FROM ledger WHERE booking = $1`, [booking])
  const pair = (last?.pair ?? 0) + 1
  await db.query(
    `INSERT INTO ledger (booking, pair, kind, account, debit_minor, credit_minor, at) VALUES ($1,$2,$3,$4,$5,0,$7), ($1,$2,$3,$6,0,$5,$7)`,
    [booking, pair, kind, debit, amount, credit, at],
  )
  await db.query(`UPDATE bookings SET ledger_seq = ledger_seq + 1 WHERE code = $1`, [booking])
}

export async function entries(db: Db, booking: string): Promise<LedgerEntry[]> {
  const found = await rows<{ id: number; pair: number; kind: LedgerEntry['kind']; account: LedgerEntry['account']; debit_minor: number; credit_minor: number; at: Date }>(
    db, `SELECT id, pair, kind, account, debit_minor, credit_minor, at FROM ledger WHERE booking = $1 ORDER BY id`, [booking])
  return found.map((entry) => ({ ...entry, at: entry.at.toISOString() }))
}

export const balance = (ledger: LedgerEntry[]): number => ledger.reduce((sum, entry) => sum + entry.debit_minor - entry.credit_minor, 0)

import { DAY_MS } from '../shared/dates'
import { LOYALTY_DAYS } from './config'
import { one, type Db } from './db'

export interface Tier { name: 'Wren' | 'Heron' | 'Kestrel'; pct: number; perks: string[]; completed: number }

export function tierOf(completed: number): Tier {
  if (completed >= 5) return { name: 'Kestrel', pct: 10, perks: ['perk.late', 'perk.drink'], completed }
  if (completed >= 2) return { name: 'Heron', pct: 5, perks: ['perk.late'], completed }
  return { name: 'Wren', pct: 0, perks: [], completed }
}

/** Completed bookings whose completion falls in the 730 days up to now. */
export async function tierFor(db: Db, userId: number | null, now: Date): Promise<Tier> {
  if (userId === null) return tierOf(0)
  const since = new Date(now.getTime() - LOYALTY_DAYS * DAY_MS)
  const row = await one<{ n: number }>(
    db,
    `SELECT count(*)::int AS n FROM bookings b
      WHERE b.owner_user = $1 AND b.completes_at > $2 AND b.completes_at <= $3
        AND EXISTS (SELECT 1 FROM booking_rooms r WHERE r.booking = b.code AND r.state = 'completed')`,
    [userId, since, now],
  )
  return tierOf(row?.n ?? 0)
}

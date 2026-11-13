import { DAY_MS } from '../shared/dates'
import { ENDED_STATES } from '../shared/rules'
import { HALF_LIFE_DAYS, COMMENT_MAX, config } from './config'
import { fail, validation } from './errors'
import { one, pool, rows, tx, type Db } from './db'
import { token } from './auth'

const ASPECTS = ['cleanliness', 'comfort', 'location', 'staff', 'value'] as const

interface ScoreRow { property: string; scores: number[]; created_at: Date }

/** Tenths of the weighted score: each review is the mean of its five scores, halving its weight every 180 days. */
function scoreTenths(reviews: { scores: number[]; created_at: Date }[], now: Date): number {
  if (!reviews.length) return 60
  let weighted = 0
  let weights = 0
  for (const review of reviews) {
    const age = Math.floor((now.getTime() - review.created_at.getTime()) / DAY_MS)
    const weight = 0.5 ** (age / HALF_LIFE_DAYS)
    weighted += weight * (review.scores.reduce((a, b) => a + b, 0) / review.scores.length)
    weights += weight
  }
  return Math.floor((weighted / weights) * 10 + 0.5 + 1e-9)
}

export async function scoresByProperty(db: Db, properties: string[], now: Date): Promise<Map<string, number>> {
  const found = await rows<ScoreRow>(db, `SELECT property, scores, created_at FROM reviews WHERE state = 'published' AND property = ANY($1)`, [properties])
  const grouped = new Map<string, ScoreRow[]>()
  for (const row of found) grouped.set(row.property, [...(grouped.get(row.property) ?? []), row])
  return new Map(properties.map((code) => [code, scoreTenths(grouped.get(code) ?? [], now)]))
}

interface ReviewBooking { code: string; property: string; in_date: string; out_date: string; completes_at: Date; owner_user: number | null }

export async function reviewAccess(db: Db, reviewToken: string, now: Date): Promise<{ booking: ReviewBooking; propertyName: string; openUntil: Date }> {
  const booking = await one<ReviewBooking & { cancelled: boolean }>(
    db,
    `SELECT b.code, b.property, b.in_date, b.out_date, b.completes_at, b.owner_user,
            NOT EXISTS (SELECT 1 FROM booking_rooms r WHERE r.booking = b.code AND r.state <> ALL($2)) AS cancelled
       FROM bookings b WHERE b.review_token = $1`,
    [reviewToken, ENDED_STATES],
  )
  if (!booking || booking.cancelled) return fail(404, 'not_found')
  const openUntil = new Date(booking.completes_at.getTime() + config.reviewWindowMs)
  if (now < booking.completes_at) return fail(403, 'too_early')
  if (now >= openUntil) return fail(410, 'window_closed')
  if (await one(db, `SELECT 1 FROM reviews WHERE booking = $1`, [booking.code])) return fail(409, 'already_reviewed')
  const property = (await one<{ name: string }>(db, `SELECT name FROM properties WHERE code = $1`, [booking.property]))!
  return { booking, propertyName: property.name, openUntil }
}

export async function submitReview(reviewToken: string, body: Record<string, unknown>, now: Date): Promise<{ id: string; state: 'pending' }> {
  return tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`review|${reviewToken}`])
    const { booking } = await reviewAccess(client, reviewToken, now)
    const fields: Record<string, string> = {}
    const scores = ASPECTS.map((aspect) => {
      const value = body[aspect]
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 10) fields[aspect] = 'review.score_range'
      return value as number
    })
    if (typeof body.comment !== 'string') fields.comment = 'required'
    else if (body.comment.length > COMMENT_MAX) fields.comment = 'too_long'
    if (Object.keys(fields).length) validation(fields)
    const id = token(8)
    await client.query(
      `INSERT INTO reviews (id, property, booking, guest_user, scores, comment, created_at, state) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`,
      [id, booking.property, booking.code, booking.owner_user, scores, body.comment, now],
    )
    return { id, state: 'pending' as const }
  })
}

export async function pendingReviews(db: Db) {
  const found = await rows<{ id: string; property: string; name: string; scores: number[]; comment: string; created_at: Date }>(
    db, `SELECT r.id, r.property, p.name, r.scores, r.comment, r.created_at FROM reviews r JOIN properties p ON p.code = r.property WHERE r.state = 'pending' ORDER BY r.created_at, r.seq`)
  return found.map((review) => ({
    id: review.id, property: { code: review.property, name: review.name }, comment: review.comment, created_at: review.created_at.toISOString(),
    scores: Object.fromEntries(ASPECTS.map((aspect, index) => [aspect, review.scores[index]])),
  }))
}

export async function moderate(id: string, action: 'published' | 'rejected'): Promise<{ id: string; state: string }> {
  const updated = await one<{ id: string; state: string }>(
    pool, `UPDATE reviews SET state = $2 WHERE id = $1 AND state = 'pending' RETURNING id, state`, [id, action])
  return updated ?? fail(409, 'not_pending')
}

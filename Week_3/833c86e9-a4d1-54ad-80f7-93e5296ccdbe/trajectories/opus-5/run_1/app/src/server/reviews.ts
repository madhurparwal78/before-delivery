import { config } from './config';
import { nowMs } from './clock';
import { one, query } from './db';
import { ApiError, conflict, gone, notFound, validation } from './errors';
import { parseDate, wallToUtc } from './zone';

export interface ReviewRow {
  id: string;
  property: string;
  code: string | null;
  username: string | null;
  visitor: string | null;
  token: string;
  scores: number[] | null;
  comment: string | null;
  state: string;
  created_at: string | null;
}

export interface ReviewWindow {
  property: string;
  in: string;
  out: string;
  open_until: string;
}

async function completionOf(code: string): Promise<number | null> {
  const row = await one<{ out_date: string; zone: string; states: string[] }>(
    `select to_char(b.out_date, 'YYYY-MM-DD') as out_date, p.zone,
       array_agg(r.state) as states
     from bookings b join properties p on p.code = b.property
     join booking_rooms r on r.code = b.code
     where b.code = $1 group by b.out_date, p.zone`,
    [code],
  );
  if (!row) return null;
  if (!row.states.includes('completed')) return null;
  const parts = parseDate(row.out_date)!;
  return wallToUtc(row.zone, parts.y, parts.m, parts.d, 11, 0);
}

export async function loadReviewByToken(token: string): Promise<ReviewRow | null> {
  return one<ReviewRow>(
    `select id, property, code, username, visitor, token, scores, comment, state,
       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
     from reviews where token = $1`,
    [token],
  );
}

/** The review window: open from completion for KIP_REVIEW_WINDOW_MS. */
export async function reviewWindow(token: string): Promise<ReviewWindow> {
  const review = await loadReviewByToken(token);
  if (!review || !review.code) throw notFound();
  const completion = await completionOf(review.code);
  if (completion === null) throw new ApiError(403, { error: 'too_early' });
  const at = nowMs();
  if (at >= completion + config.reviewWindowMs) throw gone('window_closed');
  if (review.state !== 'unused') throw conflict('already_reviewed');
  const booking = await one<{ property: string; in_date: string; out_date: string }>(
    `select property, to_char(in_date, 'YYYY-MM-DD') as in_date, to_char(out_date, 'YYYY-MM-DD') as out_date
     from bookings where code = $1`,
    [review.code],
  );
  if (!booking) throw notFound();
  return {
    property: booking.property,
    in: booking.in_date,
    out: booking.out_date,
    open_until: new Date(completion + config.reviewWindowMs).toISOString(),
  };
}

export interface ReviewSubmission {
  cleanliness: unknown;
  comfort: unknown;
  location: unknown;
  staff: unknown;
  value: unknown;
  comment: unknown;
}

const ASPECTS = ['cleanliness', 'comfort', 'location', 'staff', 'value'] as const;

export async function submitReview(token: string, body: ReviewSubmission): Promise<{ id: number; state: string }> {
  await reviewWindow(token);
  const fields: Record<string, string> = {};
  const scores: number[] = [];
  for (const aspect of ASPECTS) {
    const value = body[aspect];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10) {
      fields[aspect] = 'review.score_range';
    } else {
      scores.push(value);
    }
  }
  const comment = typeof body.comment === 'string' ? body.comment : '';
  if (comment.length > 2000) fields.comment = 'too_long';
  if (Object.keys(fields).length > 0) throw validation(fields);
  const row = await one<{ id: string }>(
    `update reviews set scores = $2, comment = $3, state = 'pending', created_at = $4, submitted_at = $4
     where token = $1 returning id`,
    [token, scores, comment, new Date(nowMs()).toISOString()],
  );
  if (!row) throw notFound();
  return { id: Number(row.id), state: 'pending' };
}

export async function pendingReviews(): Promise<
  { id: number; property: string; scores: number[]; comment: string; created_at: string }[]
> {
  const rows = await query<{ id: string; property: string; scores: number[]; comment: string; created_at: string }>(
    `select id, property, scores, comment,
       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
     from reviews where state = 'pending' order by created_at, id`,
  );
  return rows.map((row) => ({ ...row, id: Number(row.id) }));
}

export async function moderateReview(id: number, action: 'publish' | 'reject'): Promise<{ id: number; state: string }> {
  const row = await one<{ state: string }>('select state from reviews where id = $1', [id]);
  if (!row) throw notFound();
  if (row.state !== 'pending') throw conflict('not_pending');
  const state = action === 'publish' ? 'published' : 'rejected';
  await query('update reviews set state = $2 where id = $1', [id, state]);
  return { id, state };
}

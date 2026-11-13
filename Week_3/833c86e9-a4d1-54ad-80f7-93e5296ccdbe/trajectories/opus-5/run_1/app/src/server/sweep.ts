import { convertTotal } from '../shared/money';
import { nowMs } from './clock';
import { query, withTx } from './db';
import { broadcast, sendToContext, sendToUser } from './events';
import { completedStays, tierOf } from './loyalty';
import { QuoteRow, loadQuoteRow } from './quotes';
import { repriceQuote } from './bookings';
import { parseDate, wallToUtc } from './zone';

interface Due {
  time: number;
  run: () => Promise<void>;
}

/** Everything that has fallen due on the server clock, applied in time order. */
export async function sweep(): Promise<void> {
  const at = nowMs();
  const due: Due[] = [];

  const holds = await query<{
    id: string;
    quote_id: string;
    visitor: string | null;
    username: string | null;
    property: string;
    expires_at: string;
  }>(
    `select id, quote_id, visitor, username, property,
       to_char(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at
     from holds where state = 'live' and expires_at <= $1`,
    [new Date(at).toISOString()],
  );
  for (const hold of holds) {
    due.push({
      time: new Date(hold.expires_at).getTime(),
      run: async () => {
        const dates = await withTx(async (client) => {
          const claims = await client.query<{ date: string }>(
            `update claims set active = false where hold_id = $1 and active
             returning to_char(date, 'YYYY-MM-DD') as date`,
            [hold.id],
          );
          await client.query(`update holds set state = 'expired' where id = $1`, [hold.id]);
          return [...new Set(claims.rows.map((r) => r.date))];
        });
        sendToContext({ visitorId: hold.visitor, username: hold.username }, 'hold.expired', { hold_id: hold.id });
        broadcast('availability', { property: hold.property, room_type: null, dates });
      },
    });
  }

  const quotes = await query<{ id: string; expires_at: string; stale: boolean }>(
    `select id, to_char(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at, stale
     from quotes where notified = false and (stale or expires_at <= $1)`,
    [new Date(at).toISOString()],
  );
  for (const quote of quotes) {
    due.push({
      time: quote.stale ? at : new Date(quote.expires_at).getTime(),
      run: async () => {
        const row = await loadQuoteRow(quote.id);
        if (!row) return;
        await query('update quotes set notified = true where id = $1', [quote.id]);
        await announceQuoteChange(row, quote.stale ? 'rate' : 'expired');
      },
    });
  }

  const rooms = await query<{
    code: string;
    n: number;
    out_date: string;
    zone: string;
    username: string | null;
    visitor: string | null;
    property: string;
  }>(
    `select r.code, r.n, to_char(b.out_date, 'YYYY-MM-DD') as out_date, p.zone, b.username, b.visitor, b.property
     from booking_rooms r
     join bookings b on b.code = r.code
     join properties p on p.code = b.property
     where r.state in ('confirmed', 'changed')`,
  );
  for (const room of rooms) {
    const parts = parseDate(room.out_date)!;
    const completion = wallToUtc(room.zone, parts.y, parts.m, parts.d, 11, 0);
    if (completion > at) continue;
    due.push({
      time: completion,
      run: async () => {
        await query(
          `update booking_rooms set state = 'completed', completed_at = $3 where code = $1 and n = $2`,
          [room.code, room.n, new Date(completion).toISOString()],
        );
        await onCompletion(room.code, room.username, room.visitor, room.property, completion);
      },
    });
  }

  due.sort((a, b) => a.time - b.time);
  for (const item of due) await item.run();
}

export async function announceQuoteChange(row: QuoteRow, reason: 'rate' | 'expired'): Promise<void> {
  const fresh = await repriceQuote(row);
  sendToContext({ visitorId: row.visitor, username: row.username }, 'quote.changed', {
    quote_id: row.id,
    reason,
    old_total_minor: convertTotal(row.data.total_minor, row.currency, row.rates),
    new_total_minor: convertTotal(fresh, row.currency, row.rates),
  });
}

async function onCompletion(
  code: string,
  username: string | null,
  visitor: string | null,
  property: string,
  at: number,
): Promise<void> {
  const review = await query<{ token: string }>('select token from reviews where code = $1', [code]);
  const token = review[0]?.token;
  if (token) {
    const existing = await query('select 1 from inbox where link = $1', [`/reviews/${token}`]);
    if (existing.length === 0) {
      await query(
        `insert into inbox (username, visitor, kind, property, link, at) values ($1,$2,'review',$3,$4,$5)`,
        [username, visitor, property, `/reviews/${token}`, new Date(at).toISOString()],
      );
    }
  }
  if (username) {
    const stays = await completedStays(username, nowMs());
    sendToUser(username, 'account.changed', {
      tier: tierOf(stays).name,
      completed_stays: stays,
    });
  }
}

/** Marks every quote of a property stale and announces it. */
export async function markQuotesStale(property: string, dates: string[]): Promise<void> {
  const rows = await query<{ id: string }>(
    `update quotes set stale = true
     where property = $1 and stale = false and expires_at > $2
       and exists (
         select 1 from unnest($3::date[]) as d(date)
         where d.date >= in_date and d.date < out_date
       )
     returning id`,
    [property, new Date(nowMs()).toISOString(), dates],
  );
  for (const row of rows) {
    const quote = await loadQuoteRow(row.id);
    if (!quote) continue;
    await query('update quotes set notified = true where id = $1', [row.id]);
    await announceQuoteChange(quote, 'rate');
  }
}

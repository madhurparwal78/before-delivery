import { randomUUID } from 'node:crypto';
import { inTransaction, pool } from './db/pool.js';
import { config } from './config.js';
import { ApiError } from './http/errors.js';
import { enqueue } from './domain/queue.js';
import { formatAmount } from './domain/money.js';
import { formatInZone, monthLabel, monthRange } from './domain/time.js';
import { headingLine, renderPdf, sectionLine } from './pdf.js';
import { putObject } from './providers/s3.js';
import type { PdfLine } from './pdf.js';
import type { Venue } from './domain/types.js';

export const statementsUnavailable = (): ApiError => new ApiError(503, 'statements_unavailable');
export const documentsUnavailable = (): ApiError => new ApiError(503, 'documents_unavailable');

export const statementKey = (venueId: string, memberId: string, month: string): string =>
  `venues/${venueId}/statements/${memberId}/${month}.pdf`;

export const documentKey = (venueId: string, memberId: string, documentId: string): string =>
  `venues/${venueId}/documents/${memberId}/${documentId}`;

interface StatementMember {
  id: string;
  display_name: string;
  email: string;
}

async function balanceAt(memberId: string, instant: Date): Promise<number> {
  const result = await pool.query<{ total: string | null }>(
    `select sum(l.amount_cents) as total from journal_legs l
       join journal_entries e on e.id = l.entry_id
      where l.account like $1 and e.created_at < $2`,
    [`member:${memberId}:%`, instant],
  );
  return Number(result.rows[0]?.total ?? 0);
}

async function statementLines(
  venue: Venue,
  member: StatementMember,
  month: string,
): Promise<PdfLine[]> {
  const { start, end } = monthRange(venue.time_zone, month);
  const lines: PdfLine[] = [
    headingLine('Plumtide Venue statement'),
    { text: `Venue: ${venue.name}` },
    { text: `Member: ${member.display_name}` },
    { text: `Month: ${monthLabel(month)}` },
    { text: `Opening total balance: ${formatAmount(await balanceAt(member.id, start))}`, gap: 6 },
    { text: `Closing total balance: ${formatAmount(await balanceAt(member.id, end))}` },
  ];

  const deposits = await pool.query<{ amount_cents: number; card_last4: string; created_at: Date }>(
    `select amount_cents, card_last4, created_at from deposits
      where member_id = $1 and status = 'succeeded' and created_at >= $2 and created_at < $3
      order by created_at`,
    [member.id, start, end],
  );
  lines.push(sectionLine('Deposits'));
  if (deposits.rowCount === 0) lines.push({ text: 'None' });
  for (const row of deposits.rows) {
    lines.push({
      text: `${formatInZone(venue.time_zone, row.created_at)}  ${formatAmount(row.amount_cents)}  card ending ${row.card_last4}`,
    });
  }

  const refunds = await pool.query<{ amount_cents: number; created_at: Date }>(
    `select r.amount_cents, r.created_at from refunds r join deposits d on d.id = r.deposit_id
      where d.member_id = $1 and r.created_at >= $2 and r.created_at < $3 order by r.created_at`,
    [member.id, start, end],
  );
  lines.push(sectionLine('Refunds'));
  if (refunds.rowCount === 0) lines.push({ text: 'None' });
  for (const row of refunds.rows) {
    lines.push({
      text: `${formatInZone(venue.time_zone, row.created_at)}  ${formatAmount(row.amount_cents)}`,
    });
  }

  const fills = await pool.query<{
    symbol: string;
    kind: string;
    mode: string | null;
    outcome: string | null;
    side: string;
    price: number;
    quantity: number;
    fee_cents: number;
    filled_at: Date;
  }>(
    `select m.symbol, m.kind, f.mode, f.outcome, f.side, f.price, f.quantity, f.fee_cents, f.filled_at
       from fills f join markets m on m.id = f.market_id
      where f.member_id = $1 and f.filled_at >= $2 and f.filled_at < $3 order by f.sequence`,
    [member.id, start, end],
  );
  lines.push(sectionLine('Fills'));
  if (fills.rowCount === 0) lines.push({ text: 'None' });
  for (const row of fills.rows) {
    const price = row.kind === 'event' ? `${row.price}¢` : formatAmount(row.price);
    const label = row.kind === 'event' ? (row.outcome as string) : (row.mode as string);
    lines.push({
      text: `${formatInZone(venue.time_zone, row.filled_at)}  ${row.symbol}  ${label}  ${row.side}  ${price}  x${row.quantity}  fee ${formatAmount(row.fee_cents)}`,
    });
  }

  const movements = await pool.query<{ kind: string; amount_cents: number; created_at: Date }>(
    `select e.kind, l.amount_cents, e.created_at from journal_legs l
       join journal_entries e on e.id = l.entry_id
      where l.account = $1 and e.kind in ('payout','netting','liquidation')
        and e.created_at >= $2 and e.created_at < $3
      order by e.created_at`,
    [`member:${member.id}:available`, start, end],
  );
  lines.push(sectionLine('Payouts, netting and liquidations'));
  if (movements.rowCount === 0) lines.push({ text: 'None' });
  for (const row of movements.rows) {
    lines.push({
      text: `${formatInZone(venue.time_zone, row.created_at)}  ${row.kind}  ${formatAmount(row.amount_cents)}`,
    });
  }
  return lines;
}

/**
 * Generates and stores the venue's statements for one month. A month counts as already run once any
 * run for that venue and month has started; the PDF is never rendered twice for a member and month.
 */
export async function generateStatements(
  venue: Venue,
  month: string,
): Promise<{ started: boolean; members: number }> {
  const claimed = await pool.query(
    'insert into statement_runs (venue_id, month) values ($1,$2) on conflict do nothing',
    [venue.id, month],
  );
  const members = await pool.query<StatementMember>(
    'select id, display_name, email from members where venue_id = $1 order by display_name',
    [venue.id],
  );
  if (claimed.rowCount === 0) return { started: false, members: members.rowCount ?? 0 };

  for (const member of members.rows) {
    const existing = await pool.query(
      'select 1 from statements where venue_id = $1 and member_id = $2 and month = $3',
      [venue.id, member.id, month],
    );
    if (existing.rowCount !== 0) continue;

    const key = statementKey(venue.id, member.id, month);
    await putObject(key, renderPdf(await statementLines(venue, member, month)), 'application/pdf');
    await inTransaction(async (client) => {
      const inserted = await client.query(
        `insert into statements (id, venue_id, member_id, month, object_key) values ($1,$2,$3,$4,$5)
         on conflict (venue_id, member_id, month) do nothing`,
        [randomUUID(), venue.id, member.id, month, key],
      );
      if (inserted.rowCount === 0) return;
      await enqueue(client, 'email', `statement:${venue.id}:${member.id}:${month}`, {
        to: member.email,
        subject: `Your ${monthLabel(month)} statement is ready`,
        body: `Your ${monthLabel(month)} statement for ${venue.name} is ready. Open it at ${config.app.publicUrl}/statements`,
      });
    });
  }
  return { started: true, members: members.rowCount ?? 0 };
}

export async function clearFailedRun(venueId: string, month: string): Promise<void> {
  await pool.query('delete from statement_runs where venue_id = $1 and month = $2', [venueId, month]);
}

import type { StatementLine, StatementResponse } from '../../shared/api.js';
import { formatPeriod } from '../../shared/money.js';
import { query, transaction } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { renderPdf } from '../providers/gotenberg.js';
import { objectKeys, putObject } from '../providers/storage.js';
import { statementHtml } from './documents.js';
import { queueMail, sendNow } from './outbox.js';

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function readPeriod(value: unknown): { period: string; start: Date; end: Date } {
  if (typeof value !== 'string') {
    throw ApiError.validation({ period: 'Send a period as YYYY-MM.' });
  }
  const match = PERIOD_PATTERN.exec(value);
  if (!match) {
    throw ApiError.validation({ period: 'Send a period as YYYY-MM.' });
  }
  const year = Number.parseInt(match[1] ?? '0', 10);
  const month = Number.parseInt(match[2] ?? '0', 10);
  return {
    period: value,
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

interface LineRow {
  occurred_at: Date;
  piece_title: string;
  edition_number: number;
  party: 'creator' | 'remixer' | 'platform';
  kind: 'sale' | 'refund';
  is_remix: boolean;
  amount_cents: number;
}

/**
 * A creator's own split rows in the period. `sale` for a non-remix sale,
 * `remix_sale` for the remixer's row, `royalty` for the original creator's row
 * and `refund` for a reversal.
 */
function toStatementLine(row: LineRow): StatementLine {
  let kind: StatementLine['kind'];
  if (row.kind === 'refund') {
    kind = 'refund';
  } else if (!row.is_remix) {
    kind = 'sale';
  } else {
    kind = row.party === 'remixer' ? 'remix_sale' : 'royalty';
  }
  return {
    date: row.occurred_at.toISOString().slice(0, 10),
    piece_title: row.piece_title,
    edition: row.edition_number,
    kind,
    amount_cents: row.amount_cents,
  };
}

async function statementLines(creatorId: string, start: Date, end: Date): Promise<StatementLine[]> {
  const result = await query<LineRow>(
    `SELECT s.occurred_at, s.party, s.kind, s.amount_cents,
            o.edition_number, p.title AS piece_title,
            (p.remix_of_id IS NOT NULL) AS is_remix
     FROM split_rows s
     JOIN edition_orders o ON o.id = s.order_id
     JOIN pieces p ON p.id = o.piece_id
     WHERE s.holder_user_id = $1 AND s.occurred_at >= $2 AND s.occurred_at < $3
     ORDER BY s.occurred_at, s.id`,
    [creatorId, start, end],
  );
  return result.rows.map(toStatementLine);
}

export async function getStatement(
  creatorId: string,
  periodValue: string,
): Promise<StatementResponse> {
  const { period, start, end } = readPeriod(periodValue);
  const lines = await statementLines(creatorId, start, end);
  const closed = await query('SELECT 1 FROM statement_periods WHERE period = $1', [period]);

  return {
    period,
    status: (closed.rowCount ?? 0) > 0 ? 'closed' : 'open',
    lines,
    total_cents: lines.reduce((sum, line) => sum + line.amount_cents, 0),
  };
}

/**
 * Closes an ended month: one statement PDF per creator with lines, stored and
 * emailed once. A month closes at 00:00 UTC on the 1st of the next month.
 */
export async function closeStatementPeriod(body: unknown): Promise<{ period: string; creators: number }> {
  const { period, start, end } = readPeriod((body as { period?: unknown } | null)?.period);

  if (Date.now() < end.getTime()) {
    throw new ApiError(409, 'period_open', `${formatPeriod(period)} is still open.`);
  }

  const alreadyClosed = await query('SELECT 1 FROM statement_periods WHERE period = $1', [period]);
  if ((alreadyClosed.rowCount ?? 0) > 0) {
    throw new ApiError(409, 'period_closed', `${formatPeriod(period)} is already closed.`);
  }

  const creators = await query<{ id: string; display_name: string; email: string }>(
    `SELECT DISTINCT u.id, u.display_name, u.email
     FROM split_rows s
     JOIN app_users u ON u.id = s.holder_user_id
     WHERE s.occurred_at >= $1 AND s.occurred_at < $2
     ORDER BY u.display_name`,
    [start, end],
  );

  interface RenderedStatement {
    readonly creator: { id: string; display_name: string; email: string };
    readonly lines: readonly StatementLine[];
    readonly totalCents: number;
    readonly objectKey: string;
  }

  // Render and store every statement before the month is marked closed, so a
  // PDF or storage outage leaves the month closable rather than half done.
  const rendered: RenderedStatement[] = [];
  for (const creator of creators.rows) {
    const lines = await statementLines(creator.id, start, end);
    const totalCents = lines.reduce((sum, line) => sum + line.amount_cents, 0);
    const pdf = await renderPdf(statementHtml({ period, creatorName: creator.display_name, lines, totalCents }));
    const objectKey = objectKeys.statement(period, creator.id);
    await putObject(objectKey, pdf, 'application/pdf');
    rendered.push({ creator, lines, totalCents, objectKey });
  }

  const queued = await transaction(async (client) => {
    const claimed = await client.query<{ period: string }>(
      `INSERT INTO statement_periods (period, creators) VALUES ($1, $2)
       ON CONFLICT (period) DO NOTHING
       RETURNING period`,
      [period, rendered.length],
    );
    if (claimed.rows.length === 0) {
      throw new ApiError(409, 'period_closed', `${formatPeriod(period)} is already closed.`);
    }

    const messageIds: string[] = [];
    for (const entry of rendered) {
      await client.query(
        'INSERT INTO statement_files (period, creator_id, object_key) VALUES ($1, $2, $3)',
        [period, entry.creator.id, entry.objectKey],
      );
      messageIds.push(
        await queueMail(client, {
          recipient: entry.creator.email,
          subject: `Your ${formatPeriod(period)} statement from Phosphene Yard`,
          bodyText: [
            `Your ${formatPeriod(period)} statement is attached.`,
            '',
            `It lists ${entry.lines.length} ${entry.lines.length === 1 ? 'line' : 'lines'} and totals $${(Math.abs(entry.totalCents) / 100).toFixed(2)}.`,
            '',
            'Phosphene Yard',
          ].join('\n'),
          attachmentKey: entry.objectKey,
          attachmentName: `statement-${period}.pdf`,
        }),
      );
    }
    return messageIds;
  });

  for (const messageId of queued) {
    await sendNow(messageId);
  }

  return { period, creators: rendered.length };
}

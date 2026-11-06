import { minorToBillingAmount } from '../domain/money.js';
import { splitRoyalty } from '../domain/royalty.js';
import { coopMonthBounds, displayCoopTime, isoInstant } from '../domain/time.js';
import { serverNow } from './clock.js';
import { db, queryOn, withTransaction, type Queryable } from './db/pool.js';
import { loadCredits } from './data/essays.js';
import { apiError, validationFailed } from './http/errors.js';
import { BillingRefused, BillingUnreachable, recordPayout } from './services/billing.js';

export interface StatementShare {
  handle: string;
  name: string;
  position: number;
  split_bp: number;
  amount_minor: number;
}

export interface StatementLine {
  licence_id: string;
  essay_title: string;
  newsroom: { slug: string; name: string };
  confirmed_at: string;
  confirmed_display: string;
  amount_minor: number;
  rate_bp: number;
  commission_minor: number;
  shares: StatementShare[];
}

export interface StatementBody {
  month: string;
  lines: StatementLine[];
  totals: {
    invoiced_minor: number;
    commission_minor: number;
    contributors: Array<{ handle: string; name: string; amount_minor: number }>;
  };
  payouts: Array<{ handle: string; amount_minor: number; state: 'queued' | 'recorded' }>;
}

export async function statementExists(client: Queryable, month: string): Promise<boolean> {
  const result = await queryOn<{ month: string }>(
    client,
    'select month from royalty_statements where month = $1',
    [month],
  );
  return result.rows.length > 0;
}

export async function readStatement(client: Queryable, month: string): Promise<StatementBody | null> {
  if (!(await statementExists(client, month))) return null;
  const lines = await queryOn<{
    licence_id: string;
    essay_title: string;
    newsroom_slug: string;
    newsroom_name: string;
    confirmed_at: Date;
    amount_minor: number;
    rate_bp: number;
    commission_minor: number;
  }>(
    client,
    `select licence_id, essay_title, newsroom_slug, newsroom_name, confirmed_at, amount_minor,
            rate_bp, commission_minor
     from statement_lines where month = $1 order by confirmed_at, licence_id`,
    [month],
  );
  const shares = await queryOn<{
    licence_id: string;
    handle: string;
    name: string;
    position: number;
    split_bp: number;
    amount_minor: number;
  }>(
    client,
    `select licence_id, handle, name, position, split_bp, amount_minor
     from statement_shares where month = $1 order by licence_id, position`,
    [month],
  );
  const payouts = await queryOn<{ handle: string; amount_minor: number; state: 'queued' | 'recorded' }>(
    client,
    'select handle, amount_minor, state from payouts where month = $1 order by handle',
    [month],
  );
  const contributorTotals = new Map<string, { handle: string; name: string; amount_minor: number }>();
  const body: StatementBody = {
    month,
    lines: lines.rows.map((line) => ({
      licence_id: line.licence_id,
      essay_title: line.essay_title,
      newsroom: { slug: line.newsroom_slug, name: line.newsroom_name },
      confirmed_at: isoInstant(line.confirmed_at),
      confirmed_display: displayCoopTime(line.confirmed_at),
      amount_minor: line.amount_minor,
      rate_bp: line.rate_bp,
      commission_minor: line.commission_minor,
      shares: shares.rows
        .filter((share) => share.licence_id === line.licence_id)
        .map((share) => {
          const running = contributorTotals.get(share.handle) ?? {
            handle: share.handle,
            name: share.name,
            amount_minor: 0,
          };
          running.amount_minor += share.amount_minor;
          contributorTotals.set(share.handle, running);
          return {
            handle: share.handle,
            name: share.name,
            position: share.position,
            split_bp: share.split_bp,
            amount_minor: share.amount_minor,
          };
        }),
    })),
    totals: {
      invoiced_minor: lines.rows.reduce((total, line) => total + line.amount_minor, 0),
      commission_minor: lines.rows.reduce((total, line) => total + line.commission_minor, 0),
      contributors: [],
    },
    payouts: payouts.rows.map((payout) => ({
      handle: payout.handle,
      amount_minor: payout.amount_minor,
      state: payout.state,
    })),
  };
  body.totals.contributors = [...contributorTotals.values()].sort((left, right) =>
    left.handle < right.handle ? -1 : 1,
  );
  return body;
}

/** One statement per closed co-op month, stored once and returned unchanged after that. */
export async function runStatement(month: string): Promise<{ status: 200 | 201; body: StatementBody }> {
  const now = await serverNow();
  const bounds = coopMonthBounds(month);
  if (now.getTime() < bounds.end.getTime()) {
    throw validationFailed({ month: "That month hasn't closed in co-op time" });
  }
  const existing = await readStatement(db, month);
  if (existing) return { status: 200, body: existing };
  const pending = await queryOn<{ count: string }>(
    db,
    `select count(*) as count from licences
     where confirmed_at >= $1 and confirmed_at < $2
       and state = 'pending_invoice' and hold_until > $3`,
    [bounds.start, bounds.end, now],
  );
  if (Number(pending.rows[0]?.count ?? '0') > 0) {
    throw apiError(409, 'invoices_pending', 'Some licences from that month are still pending invoice.');
  }
  await withTransaction(async (client) => {
    await queryOn(
      client,
      `insert into royalty_statements (month, created_at, invoiced_minor, commission_minor)
       values ($1, $2, 0, 0)`,
      [month, now],
    );
    const licences = await queryOn<{
      id: string;
      essay_id: string;
      essay_title: string;
      newsroom_slug: string;
      newsroom_name: string;
      confirmed_at: Date;
      amount_minor: number;
      rate_bp: number;
    }>(
      client,
      `select l.id, l.essay_id, e.title as essay_title, l.newsroom_slug, n.name as newsroom_name,
              l.confirmed_at, l.amount_minor, l.rate_bp
       from licences l join essays e on e.id = l.essay_id join newsrooms n on n.slug = l.newsroom_slug
       where l.confirmed_at >= $1 and l.confirmed_at < $2 and l.invoice_state = 'raised'
       order by l.confirmed_at, l.id`,
      [bounds.start, bounds.end],
    );
    let invoiced = 0;
    let commission = 0;
    for (const licence of licences.rows) {
      const credits = await loadCredits(client, licence.essay_id);
      const split = splitRoyalty(
        licence.amount_minor,
        licence.rate_bp,
        credits.map((credit) => ({
          handle: credit.contributor_handle,
          position: credit.position,
          splitBp: credit.split_bp,
        })),
      );
      invoiced += licence.amount_minor;
      commission += split.commissionMinor;
      await queryOn(
        client,
        `insert into statement_lines (month, licence_id, essay_title, newsroom_slug, newsroom_name,
           confirmed_at, amount_minor, rate_bp, commission_minor)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          month,
          licence.id,
          licence.essay_title,
          licence.newsroom_slug,
          licence.newsroom_name,
          licence.confirmed_at,
          licence.amount_minor,
          licence.rate_bp,
          split.commissionMinor,
        ],
      );
      for (const share of split.shares) {
        const credit = credits.find((entry) => entry.contributor_handle === share.handle);
        await queryOn(
          client,
          `insert into statement_shares (month, licence_id, handle, name, position, split_bp, amount_minor)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [month, licence.id, share.handle, credit?.name ?? share.handle, share.position, share.splitBp, share.amountMinor],
        );
      }
    }
    await queryOn(
      client,
      'update royalty_statements set invoiced_minor = $2, commission_minor = $3 where month = $1',
      [month, invoiced, commission],
    );
  });
  const body = await readStatement(db, month);
  if (!body) throw apiError(409, 'invoices_pending', 'That statement could not be stored.');
  return { status: 201, body };
}

/** One payout per contributor with a non-zero month total, recorded in billing exactly once. */
export async function createPayouts(month: string): Promise<StatementBody> {
  const statement = await readStatement(db, month);
  if (!statement) throw validationFailed({ month: 'Run that month before recording payouts' });
  if (statement.payouts.length === 0) {
    await withTransaction(async (client) => {
      for (const contributor of statement.totals.contributors) {
        if (contributor.amount_minor <= 0) continue;
        await queryOn(
          client,
          `insert into payouts (month, handle, name, amount_minor, state, next_attempt_at)
           values ($1, $2, $3, $4, 'queued', now())
           on conflict (month, handle) do nothing`,
          [month, contributor.handle, contributor.name, contributor.amount_minor],
        );
      }
    });
  }
  await settleQueuedPayouts(month);
  const body = await readStatement(db, month);
  if (!body) throw validationFailed({ month: 'Run that month before recording payouts' });
  return body;
}

export async function settleQueuedPayouts(month?: string): Promise<void> {
  const queued = await queryOn<{ month: string; handle: string; name: string; amount_minor: number }>(
    db,
    `select month, handle, name, amount_minor from payouts
     where state = 'queued' and ($1::text is null or month = $1)
       and (next_attempt_at is null or next_attempt_at <= now())
     order by month, handle`,
    [month ?? null],
  );
  for (const payout of queued.rows) {
    try {
      await recordPayout({
        handle: payout.handle,
        name: payout.name,
        month: payout.month,
        amount: minorToBillingAmount(payout.amount_minor),
      });
      await queryOn(
        db,
        `update payouts set state = 'recorded', next_attempt_at = null
         where month = $1 and handle = $2`,
        [payout.month, payout.handle],
      );
    } catch (error) {
      if (error instanceof BillingUnreachable || error instanceof BillingRefused) {
        await queryOn(
          db,
          `update payouts set next_attempt_at = now() + interval '5 seconds'
           where month = $1 and handle = $2`,
          [payout.month, payout.handle],
        );
        continue;
      }
      throw error;
    }
  }
}

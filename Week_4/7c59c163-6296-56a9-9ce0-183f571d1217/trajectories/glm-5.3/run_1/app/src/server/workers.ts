import type { AppConfig } from './config.js';
import type { Pool } from './db.js';
import { Mailer } from './mailer.js';
import type { SvixClient } from './svix.js';
import { Bus } from './valkey.js';
import { claimBatch, complete, fail } from './queue.js';
import { renderEmail, type EmailPayload } from './emails.js';
import { S3Client } from '@aws-sdk/client-s3';
import { getObjectBytes, putObjectBytes } from './s3.js';
import { buildStatementInput, renderStatementPdf } from './statements.js';

export interface Workers {
  workerId: string;
  pool: Pool;
  config: AppConfig;
  mailer: Mailer;
  svix: SvixClient;
  bus: Bus;
  s3: S3Client;
}

export function startWorkers(deps: Workers): void {
  const { workerId, pool, config, mailer, svix, bus, s3 } = deps;

  const tick = async (): Promise<void> => {
    const rows = await claimBatch(pool, workerId, ['email', 'webhook', 'book', 'member_event'], 20).catch(() => []);
    for (const row of rows) {
      try {
        if (row.kind === 'email') {
          const payload = row.payload as unknown as EmailPayload;
          const rendered = await renderEmail(pool, config, payload);
          if (rendered) {
            await mailer.send({ to: rendered.to, subject: rendered.subject, text: rendered.text });
          }
        } else if (row.kind === 'webhook') {
          await deliverWebhook(pool, svix, row.payload, row.venue_id);
        } else if (row.kind === 'book') {
          await publishBook(pool, bus, row.payload);
        } else if (row.kind === 'member_event') {
          await publishMemberEvent(pool, bus, row.payload);
        }
        await complete(row.id, pool);
      } catch {
        const attempts = row.attempts;
        const backoff = row.kind === 'email'
          ? 10000
          : row.kind === 'webhook'
            ? Math.min(60000, 5000 * 2 ** Math.max(0, attempts - 1))
            : 2000;
        await fail(row.id, pool, backoff).catch(() => undefined);
      }
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, 500);
  interval.unref?.();
}

async function deliverWebhook(pool: Pool, svix: SvixClient, payload: Record<string, unknown>, venueId: string | null): Promise<void> {
  if (!venueId) return;
  const memberId = String(payload['member_id']);
  const res = await pool.query(
    `SELECT m.id, v.slug FROM members m JOIN venues v ON v.id = m.venue_id WHERE m.id = $1`,
    [memberId]
  );
  const row = res.rows[0] as { id: string; slug: string } | undefined;
  if (!row) return;
  const appUid = `venue-${row.slug}`;
  await svix.ensureApplication(appUid, row.slug);
  const endpointRes = await pool.query(`SELECT svix_endpoint_id FROM webhook_endpoints WHERE member_id = $1`, [memberId]);
  const endpoint = (endpointRes.rows[0] as { svix_endpoint_id: string } | undefined)?.svix_endpoint_id;
  if (!endpoint) return;

  const eventType = String(payload['event_type']);
  const payloadBody: Record<string, unknown> = {};
  const eventField: Record<string, string> = {
    'order.filled': 'fill_id',
    'position.liquidated': 'position_id',
    'event.settled': 'position_key',
  };
  void eventField;

  if (eventType === 'order.filled') {
    payloadBody['event_id'] = `fill_${String(payload['fill_id'])}`;
    payloadBody['type'] = 'order.filled';
    payloadBody['venue'] = row.slug;
    payloadBody['market_id'] = payload['market_id'];
    payloadBody['market_symbol'] = payload['market_symbol'];
    payloadBody['order_id'] = payload['order_id'];
    payloadBody['fill_id'] = payload['fill_id'];
    payloadBody['mode'] = payload['mode'];
    payloadBody['side'] = payload['side'];
    payloadBody['outcome'] = payload['outcome'];
    payloadBody['price'] = payload['price'];
    payloadBody['quantity'] = payload['quantity'];
    payloadBody['fee_cents'] = payload['fee_cents'];
    payloadBody['liquidity'] = payload['liquidity'];
    payloadBody['order_status'] = payload['order_status'];
    payloadBody['remaining_quantity'] = payload['remaining_quantity'] ?? 0;
    payloadBody['filled_at'] = payload['filled_at'];
  } else if (eventType === 'position.liquidated') {
    payloadBody['event_id'] = `liq_${String(payload['position_id'])}`;
    payloadBody['type'] = 'position.liquidated';
    payloadBody['venue'] = row.slug;
    payloadBody['market_id'] = payload['market_id'];
    payloadBody['position_id'] = payload['position_id'];
    payloadBody['side'] = payload['side'];
    payloadBody['quantity'] = payload['quantity'];
    payloadBody['mark_price'] = payload['mark_price'];
    payloadBody['returned_cents'] = payload['returned_cents'];
    payloadBody['liquidated_at'] = payload['liquidated_at'];
  } else if (eventType === 'event.settled') {
    payloadBody['event_id'] = `settle_${String(payload['market_id'])}_${String(payload['position_key'] ?? memberId)}`;
    payloadBody['type'] = 'event.settled';
    payloadBody['venue'] = row.slug;
    payloadBody['market_id'] = payload['market_id'];
    payloadBody['outcome'] = payload['outcome'];
    payloadBody['contracts'] = payload['contracts'];
    payloadBody['payout_cents'] = payload['payout_cents'];
    payloadBody['settled_at'] = payload['settled_at'];
  } else {
    return;
  }
  payloadBody['channel'] = `member-${memberId}`;
  await svix.sendMessage(appUid, payloadBody);
}

async function publishBook(pool: Pool, bus: Bus, payload: Record<string, unknown>): Promise<void> {
  const marketId = payload['market_id'] as string | undefined;
  if (!marketId) return;
  if (payload['event'] === 'book' || payload['event'] === 'market') {
    await bus.publish(`market:${marketId}`, String(payload['event'] ?? 'book'), payload);
    return;
  }
  // A trade or a maintenance-check request.
  await bus.publish(`market:${marketId}`, 'trade', payload);
}

async function publishMemberEvent(pool: Pool, bus: Bus, payload: Record<string, unknown>): Promise<void> {
  const memberId = payload['member_id'] as string | undefined;
  if (!memberId) return;
  const event = String(payload['event'] ?? '');
  if (event === 'balance') {
    const balances = await pool.query(
      `SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE account = $2),0) AS available,
        COALESCE(SUM(amount_cents) FILTER (WHERE account = $3),0) AS held,
        COALESCE(SUM(amount_cents) FILTER (WHERE account = $4),0) AS collateral
       FROM journal_legs WHERE account LIKE $1`,
      [`member:${memberId}:%`, `member:${memberId}:available`, `member:${memberId}:held`, `member:${memberId}:collateral`]
    );
    const row = balances.rows[0] as { available: string; held: string; collateral: string };
    await bus.publish(`member:${memberId}`, 'balance', {
      available_cents: Number(row.available),
      held_cents: Number(row.held),
      collateral_cents: Number(row.collateral),
    });
    return;
  }
  await bus.publish(`member:${memberId}`, event, payload);
}

export async function generateStatementFor(
  pool: Pool,
  config: AppConfig,
  s3: S3Client,
  venueId: string,
  memberId: string,
  month: string,
  start: Date,
  end: Date
): Promise<void> {
  const venueRes = await pool.query(`SELECT name, time_zone FROM venues WHERE id = $1`, [venueId]);
  const venue = venueRes.rows[0] as { name: string; time_zone: string } | undefined;
  if (!venue) return;
  const memberRes = await pool.query(`SELECT display_name FROM members WHERE id = $1`, [memberId]);
  const member = memberRes.rows[0] as { display_name: string } | undefined;
  if (!member) return;
  const input = await buildStatementInput(pool, venueId, memberId, month, start, end, venue.name, member.display_name);
  const pdf = await renderStatementPdf(input);
  const key = `venues/${venueId}/statements/${memberId}/${month}.pdf`;
  await putObjectBytes(s3, config.s3.bucket, key, new Uint8Array(pdf), 'application/pdf');
  const exists = await pool.query(`SELECT 1 FROM statements WHERE member_id = $1 AND month = $2`, [memberId, month]);
  if ((exists.rowCount ?? 0) === 0) {
    await pool.query(`INSERT INTO statements (id, venue_id, member_id, month) VALUES ($1,$2,$3,$4)`, [crypto.randomUUID(), venueId, memberId, month]);
  }
}

export async function readStatementPdf(
  s3: S3Client,
  bucket: string,
  venueId: string,
  memberId: string,
  month: string
): Promise<Uint8Array> {
  return getObjectBytes(s3, bucket, `venues/${venueId}/statements/${memberId}/${month}.pdf`);
}

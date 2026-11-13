import { createHmac, randomUUID } from 'node:crypto';
import { ProjectRow } from './access';
import { nowMs } from './clock';
import { config } from './config';
import { Sql, db } from './db';
import { errors } from './errors';
import { Tx } from './live';

export type WebhookEvent = 'push' | 'merge_request' | 'pipeline' | 'deployment' | 'issue';

export function targetAllowed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const port = parsed.port === '' ? (parsed.protocol === 'https:' ? '443' : '80') : parsed.port;
  return config.webhookAllow.includes(`${parsed.hostname}:${port}`);
}

export function assertTargetAllowed(url: string): void {
  if (!targetAllowed(url)) {
    throw errors.validation('url', "This target isn't on the allow-list.");
  }
}

export async function queueEvent(
  t: Tx,
  project: ProjectRow,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const hooks = await t.sql.query<{ id: string; events: string[] }>(
    'select id, events from webhooks where project_id = $1',
    [project.id],
  );
  const body = JSON.stringify(payload);
  for (const hook of hooks) {
    if (!hook.events.includes(event)) continue;
    await t.sql.query(
      `insert into deliveries (webhook_id, uuid, event, body, state, attempts, next_ms)
       values ($1, $2, $3, $4, 'pending', '[]', $5)`,
      [Number(hook.id), randomUUID(), event, body, nowMs()],
    );
  }
}

export function signature(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

type DeliveryRow = {
  id: number;
  webhook_id: number;
  uuid: string;
  event: string;
  body: string;
  state: string;
  attempts: { number: number; status_code: number | null; at: string }[];
  next_ms: number | null;
  url: string;
  secret: string;
};

async function dueDeliveries(sql: Sql): Promise<DeliveryRow[]> {
  const rows = await sql.query<DeliveryRow>(
    `select d.id, d.webhook_id, d.uuid, d.event, d.body, d.state, d.attempts, d.next_ms, w.url, w.secret
     from deliveries d join webhooks w on w.id = d.webhook_id
     where d.state = 'pending' and d.next_ms is not null and d.next_ms <= $1
     order by d.id`,
    [nowMs()],
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    webhook_id: Number(row.webhook_id),
    next_ms: row.next_ms === null ? null : Number(row.next_ms),
  }));
}

export async function flushDeliveries(): Promise<void> {
  const due = await dueDeliveries(db);
  for (const delivery of due) {
    const attemptNumber = delivery.attempts.length + 1;
    const timestamp = Math.floor(nowMs() / 1000);
    let statusCode: number | null = null;
    if (targetAllowed(delivery.url)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(delivery.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-spurline-event': delivery.event,
            'x-spurline-delivery': delivery.uuid,
            'x-spurline-timestamp': String(timestamp),
            'x-spurline-signature': signature(delivery.secret, timestamp, delivery.body),
          },
          body: delivery.body,
          redirect: 'manual',
          signal: controller.signal,
        });
        statusCode = response.status;
      } catch {
        statusCode = null;
      } finally {
        clearTimeout(timer);
      }
    }
    const attempts = [
      ...delivery.attempts,
      { number: attemptNumber, status_code: statusCode, at: new Date(nowMs()).toISOString() },
    ];
    const delivered = statusCode !== null && statusCode >= 200 && statusCode < 300;
    const gap = config.webhookRetryMs[attemptNumber - 1];
    const state = delivered ? 'delivered' : gap === undefined ? 'failed' : 'pending';
    const next = delivered || gap === undefined ? null : nowMs() + gap;
    await db.query('update deliveries set attempts = $2, state = $3, next_ms = $4 where id = $1', [
      delivery.id,
      JSON.stringify(attempts),
      state,
      next,
    ]);
  }
}

export async function redeliver(sql: Sql, deliveryId: number): Promise<number> {
  const row = await sql.one<{ webhook_id: string; event: string; body: string }>(
    'select webhook_id, event, body from deliveries where id = $1',
    [deliveryId],
  );
  if (row === null) throw errors.notFound();
  const created = await sql.one<{ id: string }>(
    `insert into deliveries (webhook_id, uuid, event, body, state, attempts, next_ms)
     values ($1, $2, $3, $4, 'pending', '[]', $5) returning id`,
    [Number(row.webhook_id), randomUUID(), row.event, row.body, nowMs()],
  );
  return Number(created?.id);
}

export function deliveryText(delivery: {
  uuid: string;
  attempts: { number: number; status_code: number | null }[];
  next_ms: number | null;
}): string {
  const attempt = delivery.attempts[delivery.attempts.length - 1];
  const code = attempt === undefined ? 'no response' : attempt.status_code === null ? 'no response' : String(attempt.status_code);
  return `Delivery ${delivery.uuid.slice(0, 7)}, attempt ${attempt === undefined ? 0 : attempt.number}, ${code}, next try ${
    delivery.next_ms === null ? 'none' : new Date(delivery.next_ms).toISOString()
  }`;
}

import { rows, tx, query } from './db.js';
import { config } from './config.js';
import { hmacSha256Hex, unseal } from './crypto.js';

import { queueMail } from './mail.js';

interface DueDelivery {
  id: string; event_id: string; sequence: string; attempts: number;
  endpoint_id: string; url: string; sealed_secret: string; workspace_slug: string;
  type: string; occurred_at: Date; bucket: string; key: string; version_id: string;
  etag: string; size: string; reason: string | null;
}

/** One webhook pass: attempts each endpoint's lowest-sequence pending delivery that is due. */
export async function webhookOnce(): Promise<void> {
  const due = await rows<DueDelivery>(
    `SELECT d.id, d.event_id, d.sequence::text AS sequence, d.attempts, e.id AS endpoint_id, e.url, e.sealed_secret,
            d.workspace_slug, ev.type, ev.occurred_at, ev.bucket, ev.key, ev.version_id, ev.etag, ev.size::text AS size, ev.reason
     FROM webhook_deliveries d
     JOIN webhook_endpoints e ON e.id = d.endpoint_id
     JOIN webhook_events ev ON ev.id = d.event_id
     WHERE d.state = 'pending' AND d.next_attempt_at <= now()
       AND NOT EXISTS (
         SELECT 1 FROM webhook_deliveries lower
         WHERE lower.endpoint_id = d.endpoint_id AND lower.state = 'pending'
           AND lower.sequence < d.sequence AND lower.id <> d.id
       )
       AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.slug = d.workspace_slug AND w.status = 'suspended')
     ORDER BY d.sequence ASC LIMIT 10`
  );
  for (const d of due) {
    await attempt(d);
  }
}

async function attempt(d: DueDelivery): Promise<void> {
  const secret = unseal(config.secretKey, d.sealed_secret);
  if (!secret) return;
  const body = JSON.stringify({
    id: d.event_id, type: d.type, sequence: Number(d.sequence), occurred_at: d.occurred_at.toISOString(),
    bucket: d.bucket, key: d.key, version_id: d.version_id, etag: d.etag, size: Number(d.size),
    ...(d.reason ? { reason: d.reason } : {}),
  });
  const t = Math.floor(Date.now() / 1000);
  const signature = hmacSha256Hex(secret, `${t}.${body}`);
  let outcome: 'ok' | 'http_status' | 'timeout' | 'connection_failed' = 'connection_failed';
  let statusCode: number | null = null;
  try {
    const res = await fetch(d.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Farshore-Event-Id': d.event_id,
        'Farshore-Event-Type': d.type,
        'Farshore-Delivery-Attempt': String(d.attempts + 1),
        'Farshore-Signature': `t=${t},v1=${signature}`,
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    });
    statusCode = res.status;
    await res.arrayBuffer();
    if (res.status >= 200 && res.status < 300) outcome = 'ok';
    else outcome = 'http_status';
  } catch (e) {
    outcome = e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'connection_failed';
  }

  const attempts = d.attempts + 1;
  if (outcome === 'ok') {
    await query(
      `UPDATE webhook_deliveries SET state = 'delivered', attempts = $1, last_status = $2, last_error = NULL,
        next_attempt_at = NULL, delivered_at = now() WHERE id = $3 AND state = 'pending'`,
      [attempts, statusCode, d.id]
    );
    return;
  }
  if (attempts >= 6) {
    await tx(async client => {
      await client.query(
        `UPDATE webhook_deliveries SET state = 'dead', attempts = $1, last_status = $2, last_error = $3, next_attempt_at = NULL WHERE id = $4`,
        [attempts, statusCode, outcome, d.id]
      );
    });
    await notifyDead(d);
    return;
  }
  const backoff = config.timing.webhookBackoff * Math.pow(2, attempts - 1);
  const jitter = Math.min(3, Math.max(0, backoff * 0.1));
  const next = new Date(Date.now() + (backoff + jitter) * 1000);
  await query(
    `UPDATE webhook_deliveries SET attempts = $1, last_status = $2, last_error = $3, next_attempt_at = $4 WHERE id = $5`,
    [attempts, statusCode, outcome, next, d.id]
  );
}

async function notifyDead(d: DueDelivery): Promise<void> {
  const owners = await rows<{ email: string }>(
    `SELECT u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_slug = $1 AND m.role = 'owner'`,
    [d.workspace_slug]
  );
  const host = new URL(d.url).host;
  for (const o of owners) {
    await queueMail(o.email, `Webhook delivery failed`, 
      `A webhook delivery failed in your workspace.\n\nEndpoint host: ${host}\nEvent type: ${d.type}\nSequence: ${Number(d.sequence)}\nAttempts: 6\n`);
  }
}

/** The webhook loop. */
export async function startWebhookLoop(): Promise<void> {
  for (;;) {
    await new Promise(r => setTimeout(r, 1000));
    try { await webhookOnce(); } catch { /* retried next tick */ }
  }
}

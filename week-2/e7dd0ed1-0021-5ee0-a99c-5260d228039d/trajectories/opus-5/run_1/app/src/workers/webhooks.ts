import { query, transaction } from '../db';
import { config } from '../config';
import { unseal } from '../crypto/seal';
import { mailDeadDelivery } from '../domain/notifications';
import { signBody } from '../domain/webhooks';

interface DueDelivery {
  id: string;
  endpoint_id: string;
  url: string;
  secret_sealed: string;
  workspace_slug: string;
  workspace_name: string;
  event_id: string;
  event_type: string;
  sequence: string;
  attempts: number;
  body: string;
}

const inFlight = new Set<string>();

/** One delivery in flight per endpoint, attempted in ascending sequence. */
async function dueDeliveries(): Promise<DueDelivery[]> {
  const found = await query<DueDelivery>(
    `select distinct on (d.endpoint_id) d.id, d.endpoint_id, e.url, e.secret_sealed, e.workspace_slug, w.name as workspace_name,
            d.event_id, d.event_type, d.sequence::text as sequence, d.attempts, d.body
     from deliveries d
     join webhook_endpoints e on e.id = d.endpoint_id
     join workspaces w on w.slug = e.workspace_slug
     where d.state = 'pending' and e.state = 'active' and w.status = 'active'
     order by d.endpoint_id, d.sequence`,
  );
  return found.filter((delivery) => !inFlight.has(delivery.endpoint_id));
}

async function attempt(delivery: DueDelivery): Promise<void> {
  const ready = await query<{ next_attempt_at: string | null }>(
    'select next_attempt_at from deliveries where id = $1 and state = $2',
    [delivery.id, 'pending'],
  );
  if (ready.length === 0) return;
  const nextAt = ready[0].next_attempt_at ? new Date(ready[0].next_attempt_at).getTime() : 0;
  if (nextAt > Date.now()) return;

  inFlight.add(delivery.endpoint_id);
  const attemptNumber = delivery.attempts + 1;
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = unseal(delivery.secret_sealed);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let status: number | null = null;
  let failure: 'http_status' | 'timeout' | 'connection_failed' | null = null;
  try {
    const response = await fetch(delivery.url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        'Farshore-Event-Id': delivery.event_id,
        'Farshore-Event-Type': delivery.event_type,
        'Farshore-Delivery-Attempt': String(attemptNumber),
        'Farshore-Signature': `t=${timestamp},v1=${signBody(secret, timestamp, delivery.body)}`,
      },
      body: delivery.body,
      signal: controller.signal,
    });
    status = response.status;
    await response.arrayBuffer().catch(() => undefined);
    if (response.status < 200 || response.status >= 300) failure = 'http_status';
  } catch (error) {
    failure = (error as Error).name === 'AbortError' ? 'timeout' : 'connection_failed';
  } finally {
    clearTimeout(timer);
    inFlight.delete(delivery.endpoint_id);
  }

  await transaction(async (client) => {
    if (failure === null) {
      await client.query(
        `update deliveries set state = 'delivered', attempts = $2, last_status = $3, last_error = null,
           next_attempt_at = null, delivered_at = date_trunc('second', now()) where id = $1`,
        [delivery.id, attemptNumber, status],
      );
      return;
    }
    if (attemptNumber >= 6) {
      await client.query(
        `update deliveries set state = 'dead', attempts = $2, last_status = $3, last_error = $4, next_attempt_at = null
         where id = $1`,
        [delivery.id, attemptNumber, status, failure],
      );
      await mailDeadDelivery(client, delivery.workspace_slug, {
        workspaceName: delivery.workspace_name,
        host: new URL(delivery.url).host,
        eventType: delivery.event_type,
        sequence: Number(delivery.sequence),
        attempts: attemptNumber,
      });
      return;
    }
    const delay = config.timing.webhookBackoff * 2 ** (attemptNumber - 1) * 1000;
    await client.query(
      `update deliveries set attempts = $2, last_status = $3, last_error = $4, next_attempt_at = $5 where id = $1`,
      [delivery.id, attemptNumber, status, failure, new Date(Date.now() + delay).toISOString()],
    );
  });
}

export async function webhookTick(): Promise<void> {
  try {
    const due = await dueDeliveries();
    await Promise.all(due.map(attempt));
  } catch {
    /* a dependency is down; the next tick retries */
  }
}

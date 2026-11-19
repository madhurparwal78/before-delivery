// Phone alerts. ntfy carries one of three fixed messages and nothing else: no name, no car, no
// amount. An alert is delivered only when ntfy answers 2xx.

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { one, query, type Row } from '../db/pool.js';

type AlertKind = 'viewing_claim' | 'new_offer' | 'offer_lapsing';
type AlertState = 'waiting' | 'delivered' | 'failed';

const ALERT_MESSAGE: Record<AlertKind, string> = {
  viewing_claim: 'New viewing claim',
  new_offer: 'New offer',
  offer_lapsing: 'Offer about to lapse',
};

export interface AlertRow extends Row {
  id: string;
  car_id: string;
  offer_id: string | null;
  kind: AlertKind;
  state: AlertState;
  attempts: number;
  created_at: Date;
  delivered_at: Date | null;
}

async function publish(kind: AlertKind): Promise<boolean> {
  const headers: Record<string, string> = { Title: config.ntfy.title, 'Content-Type': 'text/plain' };
  if (config.ntfy.username) {
    const pair = Buffer.from(`${config.ntfy.username}:${config.ntfy.password}`).toString('base64');
    headers.Authorization = `Basic ${pair}`;
  }
  try {
    const reply = await fetch(`${config.ntfy.url}/${config.ntfy.topic}`, {
      method: 'POST',
      headers,
      body: ALERT_MESSAGE[kind],
      signal: AbortSignal.timeout(3000),
    });
    await reply.text().catch(() => undefined);
    return reply.ok;
  } catch {
    return false;
  }
}

/** Records the alert, then sends it. The claim or offer succeeds whatever ntfy does. */
export async function raiseAlert(carId: string, kind: AlertKind, offerId: string | null = null): Promise<void> {
  const row = await one<AlertRow>(
    `INSERT INTO phone_alert (id, car_id, offer_id, kind, state) VALUES ($1, $2, $3, $4, 'waiting')
     ${kind === 'offer_lapsing' ? 'ON CONFLICT (offer_id) WHERE kind = \'offer_lapsing\' DO NOTHING' : ''}
     RETURNING *`,
    [randomUUID(), carId, offerId, kind],
  );
  if (!row) return;
  await deliver(row);
}

/** One send: the row is already in `waiting`, and only the request that put it there calls this. */
export async function deliver(alert: AlertRow): Promise<boolean> {
  const sent = await publish(alert.kind);
  if (sent) {
    await query(
      "UPDATE phone_alert SET state = 'delivered', attempts = attempts + 1, delivered_at = now() WHERE id = $1",
      [alert.id],
    );
    return true;
  }
  await query("UPDATE phone_alert SET state = 'failed', attempts = attempts + 1 WHERE id = $1", [alert.id]);
  return false;
}

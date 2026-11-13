import type { PoolClient } from 'pg';
import type { FulfilmentEventType } from '../shared/types.js';
import { announceBox, moveBox, syncSearch } from './boxes.js';
import { flushCharityEvent, keepCharityEvent } from './charityEvents.js';
import { businessNow } from './clock.js';
import { certificateHtml } from './documents.js';
import { sendGiftNotice, sendReceipt } from './emails.js';
import { inTransaction, query } from './db.js';
import { loadOrder, newEventId, updateOrder, type OrderRow } from './orders.js';
import { alertMaker } from './services/alerts.js';
import {
  publishDead,
  publishFulfilment,
  publishRetry,
  removeFromDeadQueue,
  type FulfilmentMessage,
} from './services/broker.js';
import { bookCourier } from './services/gateway.js';
import { renderPdf } from './services/pdf.js';
import { getObject, putObject } from './services/storage.js';

const RETRY_DELAYS_MS = [5000, 20000];
const MAX_DELIVERIES = 3;

type Executor = Pick<PoolClient, 'query'>;

/** Written in the same transaction as the paid state; published afterwards. */
export async function writeFulfilmentEvent(
  executor: Executor,
  type: FulfilmentEventType,
  reference: string,
  boxNumber: number,
  occurredAt: Date,
): Promise<string> {
  const eventId = newEventId();
  await executor.query(
    `INSERT INTO fulfilment_events (event_id, type, reference, box_number, occurred_at)
       VALUES ($1, $2, $3, $4, $5)`,
    [eventId, type, reference, boxNumber, occurredAt],
  );
  return eventId;
}

export async function publishPendingEvents(): Promise<void> {
  const rows = await query<{
    event_id: string;
    type: FulfilmentEventType;
    reference: string;
    box_number: number;
    occurred_at: Date;
  }>(
    `SELECT event_id, type, reference, box_number, occurred_at
       FROM fulfilment_events
      WHERE published_at IS NULL AND state = 'pending'
      ORDER BY created_at LIMIT 50`,
  );
  for (const row of rows) {
    try {
      await publishFulfilment({
        eventId: row.event_id,
        type: row.type,
        reference: row.reference,
        boxNumber: row.box_number,
        occurredAt: row.occurred_at.toISOString(),
      });
      await query('UPDATE fulfilment_events SET published_at = now() WHERE event_id = $1', [
        row.event_id,
      ]);
    } catch {
      return;
    }
  }
}

export async function eventsWaitingForBroker(): Promise<boolean> {
  const rows = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM fulfilment_events WHERE published_at IS NULL AND state = 'pending'",
  );
  return Number(rows[0]?.count ?? '0') > 0;
}

async function alreadyDone(eventId: string, effect: string): Promise<boolean> {
  const rows = await query(
    'SELECT 1 FROM event_effects WHERE event_id = $1 AND effect = $2',
    [eventId, effect],
  );
  return rows.length > 0;
}

async function markDone(eventId: string, effect: string): Promise<void> {
  await query(
    'INSERT INTO event_effects (event_id, effect) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [eventId, effect],
  );
}

async function once(eventId: string, effect: string, work: () => Promise<void>): Promise<void> {
  if (await alreadyDone(eventId, effect)) return;
  await work();
  await markDone(eventId, effect);
}

async function plateArtDataUri(plate: string): Promise<string | null> {
  const rows = await query<{ object_key: string; content_type: string }>(
    'SELECT object_key, content_type FROM plate_art WHERE plate = $1',
    [plate.toLowerCase()],
  );
  const row = rows[0];
  if (row === undefined) return null;
  const stored = await getObject(row.object_key);
  if (stored === null) return null;
  return `data:${row.content_type};base64,${stored.body.toString('base64')}`;
}

async function issueCertificate(order: OrderRow): Promise<void> {
  const html = certificateHtml({
    boxNumber: order.box_number,
    plate: order.plate,
    reference: order.reference,
    charityOre: order.charity_ore,
    artDataUri: await plateArtDataUri(order.plate),
  });
  const pdf = await renderPdf(html);
  const key = `certificates/${order.reference}.pdf`;
  await putObject(key, pdf, 'application/pdf');
  await query(
    "UPDATE orders SET certificate_state = 'issued', certificate_key = $2, updated_at = now() WHERE reference = $1",
    [order.reference, key],
  );
}

async function sendPaidWebhook(order: OrderRow, eventId: string): Promise<void> {
  await keepCharityEvent(eventId, 'order.paid', {
    eventId,
    reference: order.reference,
    boxNumber: order.box_number,
    plate: order.plate,
    grossOre: order.gross_ore,
    netOre: order.net_ore,
    vatOre: order.vat_ore,
    charityOre: order.charity_ore,
    makerOre: order.maker_ore,
    rateBasisPoints: order.rate_basis_points,
    paidAt: (order.paid_at ?? businessNow()).toISOString(),
  });
  await flushCharityEvent(eventId);
}

async function runPaidEffects(eventId: string, order: OrderRow): Promise<void> {
  await once(eventId, 'certificate', () => issueCertificate(order));
  await once(eventId, 'receipt', () => sendReceipt(order));
  if (order.is_gift) {
    await once(eventId, 'gift-notice', () => sendGiftNotice(order));
  }
  await once(eventId, 'webhook', () => sendPaidWebhook(order, eventId));
}

async function runPackedEffects(eventId: string, order: OrderRow): Promise<void> {
  await once(eventId, 'courier', async () => {
    const booking = await bookCourier(
      order.reference,
      order.box_number,
      order.is_gift ? (order.recipient_name ?? order.buyer_name) : order.buyer_name,
      { street: order.street, postcode: order.postcode, city: order.city },
      `${eventId}-courier`,
    );
    await inTransaction(async (client) => {
      await moveBox(client, order.box_number, 'packed', 'shipped');
      await updateOrder(client, order.reference, { tracking_code: booking.trackingCode });
    });
    announceBox(order.box_number, 'shipped');
    await syncSearch([order.box_number]);
  });
}

export async function handleFulfilmentMessage(message: FulfilmentMessage): Promise<void> {
  const rows = await query<{ state: string; deliveries: number }>(
    'SELECT state, deliveries FROM fulfilment_events WHERE event_id = $1',
    [message.eventId],
  );
  const stored = rows[0];
  if (stored === undefined || stored.state !== 'pending') return;

  const deliveries = stored.deliveries + 1;
  await query('UPDATE fulfilment_events SET deliveries = $2 WHERE event_id = $1', [
    message.eventId,
    deliveries,
  ]);
  const order = await loadOrder(message.reference);
  if (order === null) return;

  try {
    if (message.type === 'order.paid') {
      await runPaidEffects(message.eventId, order);
    } else {
      await runPackedEffects(message.eventId, order);
    }
    await query("UPDATE fulfilment_events SET state = 'done' WHERE event_id = $1", [message.eventId]);
  } catch (error) {
    const reason = String((error as Error).message).slice(0, 160);
    await query('UPDATE fulfilment_events SET last_error = $2 WHERE event_id = $1', [
      message.eventId,
      reason,
    ]);
    if (deliveries >= MAX_DELIVERIES) {
      await query(
        "UPDATE fulfilment_events SET state = 'dead', failed_at = now() WHERE event_id = $1",
        [message.eventId],
      );
      await publishDead(message);
      await alertMaker(
        'Event dead-lettered',
        `Event ${message.eventId} for box ${message.boxNumber} reached the dead-letter list.`,
      );
      return;
    }
    await publishRetry(message, RETRY_DELAYS_MS[deliveries - 1] ?? 20000);
  }
}

export interface DeadLetter {
  eventId: string;
  type: string;
  reference: string;
  boxNumber: number;
  failedAt: string;
  lastError: string;
}

export async function deadLetters(): Promise<DeadLetter[]> {
  const rows = await query<{
    event_id: string;
    type: string;
    reference: string;
    box_number: number;
    failed_at: Date;
    last_error: string | null;
  }>(
    `SELECT event_id, type, reference, box_number, failed_at, last_error
       FROM fulfilment_events WHERE state = 'dead' ORDER BY failed_at`,
  );
  return rows.map((row) => ({
    eventId: row.event_id,
    type: row.type,
    reference: row.reference,
    boxNumber: row.box_number,
    failedAt: row.failed_at.toISOString(),
    lastError: row.last_error ?? 'delivery failed',
  }));
}

async function deadMessage(eventId: string): Promise<FulfilmentMessage | null> {
  const rows = await query<{
    event_id: string;
    type: FulfilmentEventType;
    reference: string;
    box_number: number;
    occurred_at: Date;
  }>(
    `SELECT event_id, type, reference, box_number, occurred_at
       FROM fulfilment_events WHERE event_id = $1 AND state = 'dead'`,
    [eventId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    eventId: row.event_id,
    type: row.type,
    reference: row.reference,
    boxNumber: row.box_number,
    occurredAt: row.occurred_at.toISOString(),
  };
}

export async function retryDeadLetter(eventId: string): Promise<boolean> {
  const message = await deadMessage(eventId);
  if (message === null) return false;
  await removeFromDeadQueue(eventId);
  await query(
    "UPDATE fulfilment_events SET state = 'pending', deliveries = 0, failed_at = NULL, published_at = now() WHERE event_id = $1",
    [eventId],
  );
  await publishFulfilment(message);
  return true;
}

export async function dismissDeadLetter(eventId: string, note: string): Promise<boolean> {
  const message = await deadMessage(eventId);
  if (message === null) return false;
  await removeFromDeadQueue(eventId);
  await query(
    "UPDATE fulfilment_events SET state = 'dismissed', dismissal_note = $2 WHERE event_id = $1",
    [eventId, note],
  );
  return true;
}

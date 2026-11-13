import amqp from 'amqplib';
import { config, ns } from './config.js';

export class QueueDown extends Error {}

export type EventType = 'order.paid' | 'box.packed';
export interface EventMessage { eventId: string; type: EventType; reference: string; boxNumber: number; occurredAt: string }

const exchange = () => ns('press.events');
const mainQueue = () => ns('press.fulfilment');
const retryQueue = () => ns('press.fulfilment.retry');
const deadQueue = () => ns('press.fulfilment.dead');

let conn: amqp.ChannelModel | null = null;
let ch: amqp.Channel | null = null;
let connecting: Promise<void> | null = null;

export interface QueueStatus { connected: boolean; waiting: number }

async function connect(): Promise<void> {
  conn = await amqp.connect(config.amqpUrl);
  conn.on('error', () => { conn = null; ch = null; connecting = null; });
  conn.on('close', () => { conn = null; ch = null; connecting = null; });
  ch = await conn.createChannel();
  await ch.assertExchange(exchange(), 'direct', { durable: true });
  const deadExchange = `${exchange()}.dead`;
  await ch.assertExchange(deadExchange, 'fanout', { durable: true });
  await ch.assertQueue(mainQueue(), { durable: true });
  await ch.assertQueue(retryQueue(), { durable: true });
  await ch.assertQueue(deadQueue(), { durable: true });
  await ch.bindQueue(mainQueue(), exchange(), '');
  await ch.bindQueue(retryQueue(), exchange(), 'retry');
  await ch.bindQueue(deadQueue(), deadExchange, '');
}

export async function ensureConnected(): Promise<void> {
  if (ch) return;
  if (!connecting) {
    connecting = connect().catch((err) => {
      connecting = null;
      throw err;
    });
  }
  await connecting;
}

/** Publishes when connected; the caller keeps the event in Postgres when this throws. */
export async function publish(msg: EventMessage): Promise<boolean> {
  try {
    await ensureConnected();
    if (!ch) return false;
    return ch.publish(exchange(), '', Buffer.from(JSON.stringify(msg)), { persistent: true, contentType: 'application/json', messageId: msg.eventId });
  } catch {
    connecting = null;
    return false;
  }
}

export async function publishRetry(msg: EventMessage, delayMs: number): Promise<boolean> {
  // Back-offs wait in Postgres and are republished when due, so a message
  // behind a short one cannot delay the whole queue and the delivery count
  // travels with the payload.
  const { query } = await import('./db.js');
  await query(
    `INSERT INTO delayed_retries (event_id, payload, not_before) VALUES ($1, $2, $3)
     ON CONFLICT (event_id) DO UPDATE SET payload = EXCLUDED.payload, not_before = EXCLUDED.not_before`,
    [msg.eventId, JSON.stringify(msg), new Date(Date.now() + delayMs).toISOString()],
  );
  return true;
}

/** Republish delayed retries whose back-off has passed. */
export async function flushDelayedRetries(): Promise<void> {
  const { query } = await import('./db.js');
  const due = await query<{ event_id: string; payload: string }>(
    'SELECT event_id, payload FROM delayed_retries WHERE not_before <= now()',
  );
  for (const row of due) {
    const msg = JSON.parse(row.payload) as EventMessage;
    const ok = await publish(msg);
    if (ok) {
      await query('DELETE FROM delayed_retries WHERE event_id = $1', [row.event_id]);
    }
  }
}

export interface DeadLetter { eventId: string; type: string; reference: string; boxNumber: number; failedAt: string; lastError: string }

export async function deadLetters(): Promise<DeadLetter[]> {
  await ensureConnected();
  const ok = await ch!.checkQueue(deadQueue());
  const out: DeadLetter[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ok.messageCount + 1 && i < 500; i++) {
    const msg = await ch!.get(deadQueue(), { noAck: false });
    if (!msg) break;
    const body = JSON.parse(msg.content.toString()) as EventMessage & { lastError?: string };
    ch!.nack(msg, false, true);
    if (seen.has(body.eventId)) break;
    seen.add(body.eventId);
    out.push({
      eventId: body.eventId,
      type: body.type,
      reference: body.reference,
      boxNumber: body.boxNumber,
      failedAt: new Date().toISOString(),
      lastError: body.lastError ?? 'delivery failed three times',
    });
    if (out.length >= ok.messageCount) break;
  }
  return out;
}

export async function deadLetterCount(): Promise<number> {
  try {
    await ensureConnected();
    const ok = await ch!.checkQueue(deadQueue());
    return ok.messageCount;
  } catch {
    return -1;
  }
}

function deadExchangeName(): string {
  return `${exchange()}.dead`;
}

/** Retry: return the event to the main queue with three fresh deliveries. */
export async function retryDeadLetter(eventId: string): Promise<EventMessage | null> {
  await ensureConnected();
  const total = (await ch!.checkQueue(deadQueue())).messageCount;
  let found: EventMessage | null = null;
  const keep: amqp.Message[] = [];
  for (let i = 0; i < total; i++) {
    const msg = await ch!.get(deadQueue(), { noAck: true });
    if (!msg) break;
    const body = JSON.parse(msg.content.toString()) as EventMessage;
    if (body.eventId === eventId && !found) {
      found = body;
    } else {
      keep.push(msg);
    }
  }
  for (const msg of keep) {
    ch!.publish(deadExchangeName(), '', msg.content, { persistent: true });
  }
  if (found) {
    ch!.publish(exchange(), '', Buffer.from(JSON.stringify(found)), { persistent: true, messageId: found.eventId });
  }
  return found;
}

/** Dismiss: remove the event from the dead queue. */
export async function dismissDeadLetter(eventId: string): Promise<boolean> {
  await ensureConnected();
  const total = (await ch!.checkQueue(deadQueue())).messageCount;
  let found = false;
  const keep: amqp.Message[] = [];
  for (let i = 0; i < total; i++) {
    const msg = await ch!.get(deadQueue(), { noAck: true });
    if (!msg) break;
    const body = JSON.parse(msg.content.toString()) as EventMessage;
    if (body.eventId === eventId && !found) {
      found = true;
    } else {
      keep.push(msg);
    }
  }
  for (const msg of keep) {
    ch!.publish(deadExchangeName(), '', msg.content, { persistent: true });
  }
  return found;
}

export async function consume(handler: (msg: EventMessage) => Promise<void>): Promise<void> {
  await ensureConnected();
  await ch!.prefetch(1);
  await ch!.consume(mainQueue(), async (msg) => {
    if (!msg) return;
    try {
      const body = JSON.parse(msg.content.toString()) as EventMessage & { attempts?: number; lastError?: string };
      await handler(body);
      ch!.ack(msg);
    } catch (err) {
      console.error('delivery failed:', err instanceof Error ? err.message : err);
      // Retries come 5 seconds and then 20 seconds later. After the third
      // failed delivery the event moves to the dead-letter queue and the
      // maker is alerted.
      const body = JSON.parse(msg.content.toString()) as EventMessage & { attempts?: number; lastError?: string };
      const attempts = (body.attempts ?? 1) + 1;
      body.attempts = attempts;
      if (attempts > 3) {
        body.lastError = shortError(err);
        await moveToDead(body);
        // The maker's phone buzzes for a dead-lettered event.
        const { alert } = await import('./fulfilment.js');
        await alert('Event dead-lettered', `Event ${body.eventId} for box ${body.boxNumber} reached the dead-letter list.`);
        ch!.ack(msg);
      } else {
        await publishRetry(body, attempts === 2 ? 5_000 : 20_000);
        ch!.ack(msg);
      }
    }
  }, { noAck: false });
}

async function moveToDead(body: EventMessage & { lastError?: string }): Promise<void> {
  ch!.publish(deadExchangeName(), '', Buffer.from(JSON.stringify(body)), { persistent: true });
}

function shortError(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err);
  return s.slice(0, 120).replace(/\s+/g, ' ');
}

import type { PoolClient } from "pg";
import type amqp from "amqplib";
import { alertDeadLettered } from "./alerts.js";
import { getChannel, isConnected, names, publish, type FulfilmentMessage, type FulfilmentType } from "./broker.js";
import { moveBox } from "./boxes.js";
import { businessNow } from "./clock.js";
import { issueCertificate, orderPaidPayload } from "./certificates.js";
import { pool, withTx } from "./db.js";
import { bookCourier } from "./gateway.js";
import { newEventId } from "./ids.js";
import { sendMail } from "./mail.js";
import { buildMail, type Template } from "./notices.js";
import { recipientOf, requireOrder } from "./orders.js";
import { sendMessage } from "./svix.js";

/** Fulfilment events: written with the paid state, published afterwards, delivered with retries and a dead-letter list. */

export const writeEvent = async (tx: PoolClient, type: FulfilmentType, reference: string, boxNumber: number): Promise<void> => {
  await tx.query(
    "INSERT INTO events (event_id, type, reference, box_number, occurred_at) VALUES ($1, $2, $3, $4, $5)",
    [newEventId("evt"), type, reference, boxNumber, businessNow()],
  );
};

interface EventRow {
  event_id: string;
  type: FulfilmentType;
  reference: string;
  box_number: number;
  occurred_at: Date;
  attempts: number;
  state: "pending" | "done" | "dead" | "dismissed";
  last_error: string | null;
  failed_at: Date | null;
}

const messageOf = (event: EventRow): FulfilmentMessage => ({
  eventId: event.event_id, type: event.type, reference: event.reference, boxNumber: event.box_number,
  occurredAt: event.occurred_at.toISOString(),
});

const RETRY_DELAYS_MS = [5000, 20000] as const;
const MAX_DELIVERIES = 3;

class EffectFailed extends Error {}

const done = async (eventId: string, effect: string): Promise<boolean> =>
  (await pool.query("SELECT 1 FROM event_effects WHERE event_id = $1 AND effect = $2", [eventId, effect])).rowCount === 1;

const mark = async (eventId: string, effect: string): Promise<void> => {
  await pool.query("INSERT INTO event_effects (event_id, effect) VALUES ($1, $2) ON CONFLICT DO NOTHING", [eventId, effect]);
};

const sendTemplate = async (event: EventRow, template: Template): Promise<void> => {
  const order = await requireOrder(pool, event.reference);
  await sendMail(await buildMail(template, order));
};

const effects: Record<FulfilmentType, { name: string; run: (event: EventRow) => Promise<void> }[]> = {
  "order.paid": [
    { name: "certificate", run: (event) => issueCertificate(event.reference) },
    { name: "receipt", run: (event) => sendTemplate(event, "receipt") },
    {
      name: "gift",
      run: async (event) => {
        const order = await requireOrder(pool, event.reference);
        if (order.gift_email) await sendMail(await buildMail("gift", order));
      },
    },
    {
      name: "webhook",
      run: async (event) => sendMessage(event.event_id, "order.paid", await orderPaidPayload(event.reference, event.event_id)),
    },
  ],
  "box.packed": [
    {
      name: "courier",
      run: async (event) => {
        const order = await requireOrder(pool, event.reference);
        const recipient = recipientOf(order);
        const reply = await bookCourier({
          reference: order.reference, boxNumber: order.box_number, recipientName: recipient.name,
          address: { street: order.street ?? "", postcode: order.postcode ?? "", city: order.city ?? "" },
        }, `courier-${event.event_id}`);
        if (reply.status !== 201) throw new Error("courier refused the booking");
        await withTx(async (tx) => {
          await tx.query("UPDATE orders SET tracking_code = $2 WHERE reference = $1", [order.reference, String(reply.body.trackingCode)]);
          const box = await tx.query("SELECT state FROM boxes WHERE number = $1 FOR UPDATE", [order.box_number]);
          if (box.rows[0].state === "packed") await moveBox(tx, order.box_number, "shipped");
        });
      },
    },
  ],
};

const runEffects = async (event: EventRow): Promise<void> => {
  let first: string | null = null;
  for (const effect of effects[event.type]) {
    if (await done(event.event_id, effect.name)) continue;
    try {
      await effect.run(event);
      await mark(event.event_id, effect.name);
    } catch (error) {
      first ??= `${effect.name} failed: ${(error instanceof Error ? error.message : "error").replace(/\S+@\S+/g, "[address]").slice(0, 120)}`;
    }
  }
  if (first) throw new EffectFailed(first);
};

const deliver = async (body: FulfilmentMessage): Promise<void> => {
  const found = await pool.query("SELECT * FROM events WHERE event_id = $1", [body.eventId]);
  const event = found.rows[0] as EventRow | undefined;
  if (!event || event.state !== "pending") return;
  try {
    await runEffects(event);
    await pool.query("UPDATE events SET state = 'done', attempts = attempts + 1 WHERE event_id = $1", [event.event_id]);
  } catch (error) {
    const attempts = event.attempts + 1;
    const reason = error instanceof Error ? error.message : "delivery failed";
    if (attempts < MAX_DELIVERIES) {
      await pool.query("UPDATE events SET attempts = $2, last_error = $3 WHERE event_id = $1", [event.event_id, attempts, reason]);
      await publish("retry", body, { "x-due": Date.now() + (RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS[1]) });
      return;
    }
    await publish("dead", body); // first: once the row says dead, the message is already in the dead-letter queue
    await withTx(async (tx) => {
      await tx.query("UPDATE events SET state = 'dead', attempts = $2, last_error = $3, failed_at = now() WHERE event_id = $1", [event.event_id, attempts, reason]);
      await alertDeadLettered(tx, event.event_id, event.box_number);
    });
  }
};

let publishing = false;

const publishPending = async (): Promise<void> => {
  if (publishing || !isConnected()) return;
  publishing = true;
  try {
    const pending = await pool.query("SELECT * FROM events WHERE NOT published ORDER BY occurred_at, event_id LIMIT 50");
    for (const event of pending.rows as EventRow[]) {
      await publish(event.type, messageOf(event));
      await pool.query("UPDATE events SET published = true WHERE event_id = $1", [event.event_id]);
    }
  } catch {
    return;
  } finally {
    publishing = false;
  }
};

export const hasUnpublishedEvents = async (): Promise<boolean> =>
  (await pool.query("SELECT 1 FROM events WHERE NOT published LIMIT 1")).rowCount === 1;

let consumingOn: amqp.Channel | null = null;

const consume = async (): Promise<void> => {
  try {
    const channel = await getChannel();
    if (consumingOn === channel) return;
    consumingOn = channel;
    await channel.prefetch(10);
    await channel.consume(names.main, (message) => {
      if (!message) return;
      void deliver(JSON.parse(message.content.toString("utf8")) as FulfilmentMessage)
        .then(() => channel.ack(message), () => channel.nack(message, false, true))
        .catch(() => undefined);
    });
    await channel.consume(names.retry, (message) => {
      if (!message) return;
      const body = JSON.parse(message.content.toString("utf8")) as FulfilmentMessage;
      const due = Number(message.properties.headers?.["x-due"] ?? 0);
      setTimeout(() => {
        void publish(body.type, body)
          .then(() => channel.ack(message), () => channel.nack(message, false, true))
          .catch(() => undefined);
      }, Math.max(0, due - Date.now()));
    });
  } catch {
    consumingOn = null;
  }
};

export const startFulfilment = (): void => {
  setInterval(() => void consume().then(publishPending), 500).unref();
};

interface DeadLetter {
  eventId: string;
  type: FulfilmentType;
  reference: string;
  boxNumber: number;
  failedAt: string;
  lastError: string;
}

export const listDeadLetters = async (): Promise<DeadLetter[]> => {
  if (!isConnected()) await getChannel();
  const rows = await pool.query("SELECT * FROM events WHERE state = 'dead' ORDER BY failed_at, event_id");
  return (rows.rows as EventRow[]).map((event) => ({
    eventId: event.event_id, type: event.type, reference: event.reference, boxNumber: event.box_number,
    failedAt: (event.failed_at ?? event.occurred_at).toISOString(), lastError: event.last_error ?? "",
  }));
};

/** Takes the event's message out of the dead-letter queue; false when it was not there. */
const takeFromDeadQueue = async (eventId: string): Promise<boolean> => {
  const channel = await getChannel();
  const others: amqp.GetMessage[] = [];
  let found = false;
  for (;;) {
    const message = await channel.get(names.dead, { noAck: false });
    if (!message) break;
    if ((JSON.parse(message.content.toString("utf8")) as FulfilmentMessage).eventId === eventId) {
      channel.ack(message);
      found = true;
      break;
    }
    others.push(message);
  }
  for (const message of others) channel.nack(message, false, true);
  return found;
};

const deadEvent = async (eventId: string): Promise<EventRow | null> => {
  const found = await pool.query("SELECT * FROM events WHERE event_id = $1 AND state = 'dead'", [eventId]);
  return (found.rows[0] as EventRow | undefined) ?? null;
};

export const retryDeadLetter = async (eventId: string): Promise<boolean> => {
  const event = await deadEvent(eventId);
  if (!event) return false;
  await pool.query("UPDATE events SET state = 'pending', attempts = 0 WHERE event_id = $1", [eventId]);
  try {
    await publish(event.type, messageOf(event));
  } catch (error) {
    await pool.query("UPDATE events SET state = 'dead', attempts = $2 WHERE event_id = $1", [eventId, event.attempts]);
    throw error;
  }
  await takeFromDeadQueue(eventId);
  return true;
};

export const dismissDeadLetter = async (eventId: string, note: string): Promise<boolean> => {
  const event = await deadEvent(eventId);
  if (!event) return false;
  await takeFromDeadQueue(eventId);
  await pool.query("UPDATE events SET state = 'dismissed', dismissal_note = $2 WHERE event_id = $1", [eventId, note]);
  return true;
};

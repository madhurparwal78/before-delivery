import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { config, names } from '../config.js';

export class QueueUnreachable extends Error {}

export interface FulfilmentMessage {
  eventId: string;
  type: 'order.paid' | 'box.packed';
  reference: string;
  boxNumber: number;
  occurredAt: string;
}

const ROUTE_FULFILMENT = 'fulfilment';
const ROUTE_DEAD = 'dead';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let connecting = false;

async function topology(open: Channel): Promise<void> {
  await open.assertExchange(names.exchange, 'direct', { durable: true });
  await open.assertQueue(names.fulfilmentQueue, { durable: true });
  await open.assertQueue(names.retryQueue, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': names.exchange,
      'x-dead-letter-routing-key': ROUTE_FULFILMENT,
    },
  });
  await open.assertQueue(names.deadQueue, { durable: true });
  await open.bindQueue(names.fulfilmentQueue, names.exchange, ROUTE_FULFILMENT);
  await open.bindQueue(names.deadQueue, names.exchange, ROUTE_DEAD);
}

async function connect(): Promise<Channel> {
  if (channel !== null) return channel;
  if (connecting) throw new QueueUnreachable('queue connecting');
  connecting = true;
  try {
    const opened = await amqp.connect(config.amqpUrl);
    opened.on('error', () => undefined);
    opened.on('close', () => {
      connection = null;
      channel = null;
    });
    const created = await opened.createChannel();
    created.on('error', () => undefined);
    created.on('close', () => {
      channel = null;
    });
    await topology(created);
    await created.prefetch(4);
    connection = opened;
    channel = created;
    return created;
  } catch (error) {
    connection = null;
    channel = null;
    throw new QueueUnreachable(String(error));
  } finally {
    connecting = false;
  }
}

export async function brokerChannel(): Promise<Channel> {
  return connect();
}

export function brokerUp(): boolean {
  return channel !== null;
}

export async function publishFulfilment(message: FulfilmentMessage): Promise<void> {
  const open = await connect();
  const ok = open.publish(names.exchange, ROUTE_FULFILMENT, Buffer.from(JSON.stringify(message)), {
    persistent: true,
    messageId: message.eventId,
    contentType: 'application/json',
  });
  if (!ok) await new Promise<void>((resolve) => open.once('drain', resolve));
}

export async function publishRetry(message: FulfilmentMessage, delayMs: number): Promise<void> {
  const open = await connect();
  open.sendToQueue(names.retryQueue, Buffer.from(JSON.stringify(message)), {
    persistent: true,
    messageId: message.eventId,
    expiration: String(delayMs),
    contentType: 'application/json',
  });
}

export async function publishDead(message: FulfilmentMessage): Promise<void> {
  const open = await connect();
  open.publish(names.exchange, ROUTE_DEAD, Buffer.from(JSON.stringify(message)), {
    persistent: true,
    messageId: message.eventId,
    contentType: 'application/json',
  });
}

export async function consumeFulfilment(
  handler: (message: FulfilmentMessage) => Promise<void>,
): Promise<void> {
  const open = await connect();
  await open.consume(
    names.fulfilmentQueue,
    (raw: ConsumeMessage | null) => {
      if (raw === null) return;
      const message = JSON.parse(raw.content.toString()) as FulfilmentMessage;
      void handler(message).then(
        () => open.ack(raw),
        () => open.ack(raw),
      );
    },
    { noAck: false },
  );
}

export async function assertDeadQueueReadable(): Promise<void> {
  const open = await connect();
  try {
    await open.checkQueue(names.deadQueue);
  } catch (error) {
    channel = null;
    connection = null;
    throw new QueueUnreachable(String(error));
  }
}

/** Takes one event out of the dead-letter queue, leaving the others in it. */
export async function removeFromDeadQueue(eventId: string): Promise<void> {
  const open = await connect();
  const held: Buffer[] = [];
  for (;;) {
    const raw = await open.get(names.deadQueue, { noAck: false });
    if (raw === false) break;
    const message = JSON.parse(raw.content.toString()) as FulfilmentMessage;
    if (message.eventId !== eventId) held.push(raw.content);
    open.ack(raw);
  }
  for (const content of held) {
    open.publish(names.exchange, ROUTE_DEAD, content, { persistent: true, contentType: 'application/json' });
  }
}

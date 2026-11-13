/**
 * RabbitMQ: one durable queue of export messages, published once per new export
 * and acknowledged only after the export ends or is found already handled.
 */
import amqp, { type Channel } from 'amqplib';
import { config } from '../config.js';

export interface ExportMessage {
  export_id: string;
  project_id: string;
  cut_id: string;
  size: number;
  requested_by: string;
}

export class QueueDown extends Error {
  constructor(cause?: unknown) {
    super('queue unreachable');
    this.name = 'QueueDown';
    this.cause = cause;
  }
}

let channel: Channel | null = null;
let connecting: Promise<Channel> | null = null;
let queueUp = false;
let consumer: ((message: ExportMessage) => Promise<void>) | null = null;

export function queueIsUp(): boolean {
  return queueUp;
}

async function connect(): Promise<Channel> {
  const established = await amqp.connect(config.amqpUrl);
  established.on('error', () => {
    queueUp = false;
  });
  established.on('close', () => {
    queueUp = false;
    channel = null;
  });
  const opened = await established.createChannel();
  await opened.assertQueue(config.exportQueue, { durable: true });
  await opened.prefetch(1);
  channel = opened;
  queueUp = true;
  if (consumer !== null) await startConsumer(opened, consumer);
  return opened;
}

async function channelOrThrow(): Promise<Channel> {
  if (channel !== null) return channel;
  if (connecting === null) {
    connecting = connect().finally(() => {
      connecting = null;
    });
  }
  try {
    return await connecting;
  } catch (error) {
    queueUp = false;
    throw new QueueDown(error);
  }
}

export async function publishExport(message: ExportMessage): Promise<void> {
  const open = await channelOrThrow();
  const sent = open.sendToQueue(config.exportQueue, Buffer.from(JSON.stringify(message), 'utf8'), {
    persistent: true,
    contentType: 'application/json',
  });
  if (!sent) await new Promise<void>((resolve) => open.once('drain', () => resolve()));
}

async function startConsumer(open: Channel, handler: (message: ExportMessage) => Promise<void>): Promise<void> {
  await open.consume(
    config.exportQueue,
    (delivery) => {
      if (delivery === null) return;
      const body = JSON.parse(delivery.content.toString('utf8')) as ExportMessage;
      void handler(body)
        .catch(() => undefined)
        .then(() => {
          try {
            open.ack(delivery);
          } catch {
            /* the channel closed while the job ran; the message returns to the queue */
          }
        });
    },
    { noAck: false },
  );
}

export async function consumeExports(handler: (message: ExportMessage) => Promise<void>): Promise<void> {
  consumer = handler;
  const open = await channelOrThrow();
  await startConsumer(open, handler);
}

export async function probeQueue(): Promise<boolean> {
  try {
    const open = await channelOrThrow();
    await open.checkQueue(config.exportQueue);
    queueUp = true;
    return true;
  } catch {
    queueUp = false;
    channel = null;
    return false;
  }
}


import amqplib, { type ChannelModel, type ConfirmChannel, type Channel, type ConsumeMessage } from 'amqplib';
import { config } from '../config.js';
import { serviceStates } from './state.js';

const CONNECT_TIMEOUT_MS = 3_000;
const RECONNECT_DELAY_MS = 2_000;
const PUBLISH_TIMEOUT_MS = 3_000;
const RETRY_DELAY_MS = 1_500;

export type JobOutcome = 'done' | 'retry' | 'dead';
export type JobHandler = (raw: Buffer) => Promise<JobOutcome>;

interface Queues {
  work: string;
  dead: string;
}

let queues: Queues = { work: '', dead: '' };
let handler: JobHandler | null = null;
let model: ChannelModel | null = null;
let publishChannel: ConfirmChannel | null = null;
let consumeChannel: Channel | null = null;
let connecting = false;
let stopped = false;

function connectionUrl(): string {
  if (config.amqpConnectAddress === null) return config.amqpUrl;
  const url = new URL(config.amqpUrl);
  const [host, port] = config.amqpConnectAddress.split(':');
  url.hostname = host;
  if (port !== undefined) url.port = port;
  return url.toString();
}

function dropConnection(): void {
  publishChannel = null;
  consumeChannel = null;
  const old = model;
  model = null;
  if (old !== null) {
    old.removeAllListeners();
    void old.close().catch(() => undefined);
  }
  serviceStates.broker.record(false);
}

async function connect(): Promise<void> {
  if (connecting || model !== null || stopped) return;
  connecting = true;
  try {
    const connection = await amqplib.connect(connectionUrl(), { timeout: CONNECT_TIMEOUT_MS });
    connection.on('error', () => dropConnection());
    connection.on('close', () => dropConnection());
    const publisher = await connection.createConfirmChannel();
    publisher.on('error', () => dropConnection());
    await publisher.assertQueue(queues.work, { durable: true });
    await publisher.assertQueue(queues.dead, { durable: true });
    const consumer = await connection.createChannel();
    consumer.on('error', () => dropConnection());
    await consumer.prefetch(20);
    await consumer.consume(queues.work, (message) => {
      if (message !== null) void handleMessage(consumer, message);
    });
    model = connection;
    publishChannel = publisher;
    consumeChannel = consumer;
    serviceStates.broker.record(true);
  } catch {
    dropConnection();
  } finally {
    connecting = false;
  }
}

async function handleMessage(channel: Channel, message: ConsumeMessage): Promise<void> {
  if (handler === null) return;
  let outcome: JobOutcome;
  try {
    outcome = await handler(message.content);
  } catch {
    outcome = 'retry';
  }
  try {
    if (outcome === 'done') {
      channel.ack(message);
      return;
    }
    if (outcome === 'dead') {
      channel.sendToQueue(queues.dead, message.content, { persistent: true });
      channel.ack(message);
      return;
    }
    setTimeout(() => {
      try {
        channel.nack(message, false, true);
      } catch {
        /* the connection went away; the job is still on the queue */
      }
    }, RETRY_DELAY_MS);
  } catch {
    /* the connection went away; the job is still on the queue */
  }
}

export function startBroker(copyId: string, jobHandler: JobHandler): void {
  queues = { work: `interval.${copyId}.work`, dead: `interval.${copyId}.dead` };
  handler = jobHandler;
  stopped = false;
  void connect();
  setInterval(() => {
    if (model === null) void connect();
  }, RECONNECT_DELAY_MS).unref();
}

export async function stopBroker(): Promise<void> {
  stopped = true;
  dropConnection();
}

/** Publishes one durable job with a publisher confirm. */
export async function publishJob(body: unknown): Promise<boolean> {
  if (publishChannel === null) {
    void connect();
    return false;
  }
  const channel = publishChannel;
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      serviceStates.broker.record(false);
      resolve(false);
    }, PUBLISH_TIMEOUT_MS);
    try {
      channel.sendToQueue(queues.work, payload, { persistent: true }, (error) => {
        clearTimeout(timer);
        if (error) {
          serviceStates.broker.record(false);
          resolve(false);
          return;
        }
        serviceStates.broker.record(true);
        resolve(true);
      });
    } catch {
      clearTimeout(timer);
      dropConnection();
      resolve(false);
    }
  });
}

export function brokerDown(): boolean {
  return serviceStates.broker.down;
}

export function queueNames(): Queues {
  return queues;
}

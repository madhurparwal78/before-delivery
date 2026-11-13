/** RabbitMQ: the parse and webhook topology, publishing with confirms, and consumers. */

import amqp from "amqplib";
import { probeStorage } from "./storage.js";
import { probeSearch } from "./search.js";
import { probePush } from "./push.js";
import type { ChannelModel, ConfirmChannel, Channel, ConsumeMessage } from "amqplib";
import { config } from "../config.js";
import { DependencyDown } from "../errors.js";

export const PARSE_EXCHANGE = "perilune.parse";
export const PARSE_QUEUE = "perilune.parse.q";
const PARSE_DLX = "perilune.parse.dlx";
const PARSE_DEAD_QUEUE = "perilune.parse.dead";
export const PARSE_FAILED_QUEUE = "perilune.parse.failed";
export const WEBHOOK_EXCHANGE = "perilune.webhooks";
const PARSE_DELIVERY_LIMIT = 3;
export const WEBHOOK_QUEUE = "perilune.webhooks.q";

type QueueHandler = (message: ConsumeMessage, channel: Channel) => Promise<void>;

type Connected = {
  connection: ChannelModel;
  publishChannel: ConfirmChannel;
  consumeChannel: Channel;
};

const handlers = new Map<string, QueueHandler>();
let connected: Connected | null = null;
let connecting: Promise<Connected> | null = null;

export function registerConsumer(queue: string, handler: QueueHandler): void {
  handlers.set(queue, handler);
}

async function declareTopology(channel: ConfirmChannel): Promise<void> {
  await channel.assertExchange(PARSE_EXCHANGE, "direct", { durable: true });
  await channel.assertExchange(PARSE_DLX, "fanout", { durable: true });
  await channel.assertQueue(PARSE_QUEUE, {
    durable: true,
    arguments: {
      "x-queue-type": "quorum",
      "x-delivery-limit": PARSE_DELIVERY_LIMIT,
      "x-dead-letter-exchange": PARSE_DLX,
    },
  });
  await channel.bindQueue(PARSE_QUEUE, PARSE_EXCHANGE, "parse");
  for (const queue of [PARSE_DEAD_QUEUE, PARSE_FAILED_QUEUE]) {
    await channel.assertQueue(queue, {
      durable: true,
      arguments: { "x-queue-type": "quorum" },
    });
    await channel.bindQueue(queue, PARSE_DLX, "");
  }
  await channel.assertExchange(WEBHOOK_EXCHANGE, "direct", { durable: true });
  await channel.assertQueue(WEBHOOK_QUEUE, {
    durable: true,
    arguments: { "x-queue-type": "quorum" },
  });
  await channel.bindQueue(WEBHOOK_QUEUE, WEBHOOK_EXCHANGE, "send");
}

async function open(): Promise<Connected> {
  const connection = await amqp.connect(config.amqpUrl, { timeout: 3000 });
  const publishChannel = await connection.createConfirmChannel();
  const consumeChannel = await connection.createChannel();
  await consumeChannel.prefetch(1);
  await declareTopology(publishChannel);
  const drop = (): void => {
    if (connected && connected.connection === connection) {
      connected = null;
    }
  };
  connection.on("error", drop);
  connection.on("close", drop);
  const ready: Connected = { connection, publishChannel, consumeChannel };
  // Lower-priority workers still consume when no fully available worker is free.
  const parseReady = (await Promise.all([probeStorage(), probeSearch(), probePush()])).every(Boolean);
  for (const [queue, handler] of handlers) {
    await consumeChannel.consume(
      queue,
      (message) => {
        if (!message) {
          return;
        }
        void handler(message, consumeChannel).catch(() => {
          try { consumeChannel.nack(message, false, true); }
          catch { /* a closed connection leaves the delivery for the broker to redeliver */ }
        });
      },
      { noAck: false, arguments: { "x-priority": queue === WEBHOOK_QUEUE || parseReady ? 1 : 0 } },
    );
  }
  return ready;
}

/** The live connection, opened on demand; throws when the broker cannot be reached. */
export async function ensureBroker(): Promise<Connected> {
  if (connected) {
    return connected;
  }
  if (!connecting) {
    connecting = open()
      .then((ready) => {
        connected = ready;
        return ready;
      })
      .catch((error: unknown) => {
        throw new DependencyDown("queue", String(error));
      })
      .finally(() => {
        connecting = null;
      });
  }
  return connecting;
}

export async function probeQueue(): Promise<boolean> {
  try {
    await ensureBroker();
    return true;
  } catch {
    return false;
  }
}

type OutboundMessage = {
  exchange: string;
  routingKey: string;
  type: string;
  messageId: string;
  body: unknown;
};

/** Publishes one outbox row, resolving only on a publisher confirm. */
export async function publishConfirmed(message: OutboundMessage): Promise<void> {
  const { publishChannel } = await ensureBroker();
  await new Promise<void>((resolve, reject) => {
    publishChannel.publish(
      message.exchange,
      message.routingKey,
      Buffer.from(JSON.stringify(message.body), "utf8"),
      {
        persistent: true,
        contentType: "application/json",
        messageId: message.messageId,
        type: message.type,
      },
      (error) => (error ? reject(new DependencyDown("queue", String(error))) : resolve()),
    );
  });
}

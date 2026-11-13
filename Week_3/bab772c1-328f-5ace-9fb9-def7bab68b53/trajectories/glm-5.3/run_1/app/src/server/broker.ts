// RabbitMQ: queue topology, the outbox relay and the parse and webhook
// consumers. The outbox is the only path to the broker.

import * as amqp from "amqplib";
import { DependencyError, requireEnv } from "./deps.js";

export type Channel = amqp.Channel;
export type Connection = amqp.ChannelModel;

export const PARSE_EXCHANGE = "perilune.parse";
export const PARSE_QUEUE = "perilune.parse.q";
export const PARSE_DLX = "perilune.parse.dlx";
export const PARSE_DEAD = "perilune.parse.dead";
export const PARSE_FAILED = "perilune.parse.failed";
export const WEBHOOKS_EXCHANGE = "perilune.webhooks";
export const WEBHOOKS_QUEUE = "perilune.webhooks.q";

export async function connectBroker(): Promise<Connection> {
  const url = requireEnv("AMQP_URL");
  return amqp.connect(url);
}

export async function declareTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(PARSE_DLX, "fanout", { durable: true });
  await channel.assertExchange(PARSE_EXCHANGE, "direct", { durable: true });
  await channel.assertQueue(PARSE_QUEUE, {
    durable: true,
    arguments: {
      "x-queue-type": "quorum",
      "x-delivery-limit": 3,
      "x-dead-letter-exchange": PARSE_DLX,
    },
  });
  await channel.bindQueue(PARSE_QUEUE, PARSE_EXCHANGE, "parse");
  await channel.assertQueue(PARSE_DEAD, {
    durable: true,
    arguments: { "x-queue-type": "quorum" },
  });
  await channel.bindQueue(PARSE_DEAD, PARSE_DLX, "");
  await channel.assertQueue(PARSE_FAILED, {
    durable: true,
    arguments: { "x-queue-type": "quorum" },
  });
  await channel.bindQueue(PARSE_FAILED, PARSE_DLX, "");
  await channel.assertExchange(WEBHOOKS_EXCHANGE, "direct", { durable: true });
  await channel.assertQueue(WEBHOOKS_QUEUE, {
    durable: true,
    arguments: { "x-queue-type": "quorum" },
  });
  await channel.bindQueue(WEBHOOKS_QUEUE, WEBHOOKS_EXCHANGE, "send");
}

export interface OutboxMessage {
  id: string;
  kind: "pass.parse" | "webhook.send";
}

export function publishOutboxMessage(
  channel: Channel,
  row: { id: string; kind: string; pass_id: string | null; event_id: string | null; payload: unknown },
): boolean {
  const body =
    row.kind === "pass.parse"
      ? JSON.stringify({ pass_id: row.pass_id })
      : JSON.stringify({ event_id: row.event_id });
  const options: amqp.Options.Publish = {
    persistent: true,
    contentType: "application/json",
    messageId: row.id,
    type: row.kind,
  };
  if (row.kind === "pass.parse") {
    return channel.publish(PARSE_EXCHANGE, "parse", Buffer.from(body), options);
  }
  return channel.publish(WEBHOOKS_EXCHANGE, "send", Buffer.from(body), options);
}

export async function probeBroker(): Promise<boolean> {
  try {
    const connection = await connectBroker();
    await connection.close();
    return true;
  } catch {
    return false;
  }
}

export class BrokerDownError extends Error {
  constructor() {
    super("queue");
  }
}

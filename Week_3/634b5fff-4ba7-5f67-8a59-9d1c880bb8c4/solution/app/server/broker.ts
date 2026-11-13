import amqp from "amqplib";
import { config, named } from "./config.js";

/** RabbitMQ: durable exchange `press.events` with the fulfilment, retry and dead-letter queues. */

export class BrokerUnreachable extends Error {
  constructor() {
    super("broker unreachable");
  }
}

export const names = {
  exchange: named("press.events"),
  main: named("press.fulfilment"),
  retry: named("press.fulfilment.retry"),
  dead: named("press.fulfilment.dead"),
} as const;

export type FulfilmentType = "order.paid" | "box.packed";

export interface FulfilmentMessage {
  eventId: string;
  type: FulfilmentType;
  reference: string;
  boxNumber: number;
  occurredAt: string;
}

let connection: amqp.ChannelModel | null = null;
let channel: amqp.ConfirmChannel | null = null;
let connecting: Promise<amqp.ConfirmChannel> | null = null;

export const isConnected = (): boolean => channel !== null;

const open = async (): Promise<amqp.ConfirmChannel> => {
  const fresh = await amqp.connect(config.amqpUrl, { timeout: 3000 });
  const made = await fresh.createConfirmChannel();
  fresh.on("error", () => undefined);
  made.on("error", () => undefined);
  made.on("close", () => { channel = null; });
  fresh.on("close", () => { connection = null; channel = null; });
  await made.assertExchange(names.exchange, "direct", { durable: true });
  for (const queue of [names.main, names.retry, names.dead]) await made.assertQueue(queue, { durable: true });
  await made.bindQueue(names.main, names.exchange, "order.paid");
  await made.bindQueue(names.main, names.exchange, "box.packed");
  await made.bindQueue(names.retry, names.exchange, "retry");
  await made.bindQueue(names.dead, names.exchange, "dead");
  connection = fresh;
  channel = made;
  return made;
};

export const getChannel = async (): Promise<amqp.ConfirmChannel> => {
  if (channel) return channel;
  connecting ??= open().finally(() => { connecting = null; });
  try {
    return await connecting;
  } catch {
    throw new BrokerUnreachable();
  }
};

export const publish = async (routingKey: string, message: FulfilmentMessage, headers: Record<string, unknown> = {}): Promise<void> => {
  const active = await getChannel();
  active.publish(names.exchange, routingKey, Buffer.from(JSON.stringify(message)), {
    persistent: true, contentType: "application/json", headers,
  });
  await active.waitForConfirms();
};

export const closeBroker = async (): Promise<void> => {
  await connection?.close().catch(() => undefined);
};

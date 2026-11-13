// RabbitMQ: the durable intake.measure queue, its dead-letter queue, publishing with confirms and one consumer.
import amqp from "amqplib";
import { config } from "./config.js";

const MEASURE_QUEUE = "intake.measure";
const DEAD_QUEUE = "intake.measure.dead";

type MeasurementJob = { intake_file_id: string };
export type Delivery = { job: MeasurementJob | null; ack: () => void; requeue: () => void; deadLetter: () => Promise<void> };

let connection: amqp.ChannelModel | null = null;
let channel: amqp.ConfirmChannel | null = null;
let connecting: Promise<amqp.ConfirmChannel> | null = null;
let consumer: ((delivery: Delivery) => Promise<void>) | null = null;

function reset(): void {
  connection = null;
  channel = null;
}

async function open(): Promise<amqp.ConfirmChannel> {
  if (channel) return channel;
  connecting ??= (async () => {
    try {
      const conn = await amqp.connect(config.amqpUrl, { timeout: 3_000 });
      conn.on("error", () => undefined);
      conn.on("close", reset);
      const ch = await conn.createConfirmChannel();
      ch.on("error", () => undefined);
      ch.on("close", reset);
      await ch.assertQueue(MEASURE_QUEUE, { durable: true });
      await ch.assertQueue(DEAD_QUEUE, { durable: true });
      connection = conn;
      channel = ch;
      if (consumer) await startConsuming(ch, consumer);
      return ch;
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

async function startConsuming(ch: amqp.ConfirmChannel, handle: (delivery: Delivery) => Promise<void>): Promise<void> {
  await ch.prefetch(1);
  await ch.consume(MEASURE_QUEUE, (message) => {
    if (!message) return;
    let job: MeasurementJob | null = null;
    try {
      const parsed = JSON.parse(message.content.toString("utf8")) as unknown;
      if (parsed && typeof parsed === "object" && typeof (parsed as MeasurementJob).intake_file_id === "string") job = parsed as MeasurementJob;
    } catch {
      job = null;
    }
    const delivery: Delivery = {
      job,
      ack: () => ch.ack(message),
      requeue: () => ch.nack(message, false, true),
      deadLetter: async () => {
        ch.sendToQueue(DEAD_QUEUE, message.content, { persistent: true, contentType: "application/json" });
        await ch.waitForConfirms();
        ch.ack(message);
      },
    };
    handle(delivery).catch(() => delivery.requeue());
  });
}

/** Publishes one persistent job and waits for the broker's confirm; throws when the queue cannot accept it. */
export async function publishMeasurement(job: MeasurementJob): Promise<void> {
  const ch = await open();
  ch.sendToQueue(MEASURE_QUEUE, Buffer.from(JSON.stringify(job)), { persistent: true, contentType: "application/json" });
  await ch.waitForConfirms();
}

/** Registers the worker and keeps the connection alive, reconnecting on its own. */
export function consumeMeasurements(handle: (delivery: Delivery) => Promise<void>): void {
  consumer = handle;
  const tick = (): void => {
    if (!channel) open().catch(() => undefined);
  };
  tick();
  setInterval(tick, 3_000).unref();
}

export async function queueReachable(): Promise<boolean> {
  try {
    await open();
    return connection !== null;
  } catch {
    return false;
  }
}

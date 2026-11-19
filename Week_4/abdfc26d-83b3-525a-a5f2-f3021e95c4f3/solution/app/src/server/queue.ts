import { connect, type Channel, type ChannelModel, type ConfirmChannel, type ConsumeMessage } from "amqplib";
import { config } from "./config.js";

// Render jobs on the durable RENDER_QUEUE (persistent, manual ack) and out-of-retries jobs on <queue>.dead.

export interface RenderJob {
  render_id: string;
  piece_slug: string;
  attempt: number;
}

const QUEUE = config.renderQueue;
const DEAD = `${QUEUE}.dead`;
const PREFETCH = 16;

let publisher: ConfirmChannel | null = null;

async function declare(channel: Channel): Promise<void> {
  await channel.assertQueue(QUEUE, { durable: true });
  await channel.assertQueue(DEAD, { durable: true });
}

function parseJob(message: ConsumeMessage): RenderJob | null {
  try {
    const body = JSON.parse(message.content.toString("utf8")) as Partial<RenderJob>;
    if (typeof body.render_id !== "string" || typeof body.piece_slug !== "string") return null;
    return { render_id: body.render_id, piece_slug: body.piece_slug, attempt: typeof body.attempt === "number" ? body.attempt : 1 };
  } catch {
    return null;
  }
}

/** Connects, consumes render jobs with `handle` (acked once its state change is committed) and reconnects on loss. */
export function startConsumer(handle: (job: RenderJob) => Promise<void>): void {
  const run = async (): Promise<void> => {
    let connection: ChannelModel;
    try {
      connection = await connect(config.amqpUrl);
    } catch (error) {
      console.error("rabbitmq connect failed:", error instanceof Error ? error.message : error);
      setTimeout(() => void run(), 2000);
      return;
    }
    connection.on("error", (error: Error) => console.error("rabbitmq connection error:", error.message));
    connection.on("close", () => {
      publisher = null;
      setTimeout(() => void run(), 2000);
    });
    try {
      const confirm = await connection.createConfirmChannel();
      await declare(confirm);
      publisher = confirm;
      const consumer = await connection.createChannel();
      await consumer.prefetch(PREFETCH);
      await consumer.consume(QUEUE, (message) => {
        if (!message) return;
        const job = parseJob(message);
        if (!job) {
          consumer.ack(message);
          return;
        }
        handle(job).then(
          () => consumer.ack(message),
          (error: unknown) => {
            console.error(`render job ${job.render_id} failed to settle:`, error instanceof Error ? error.message : error);
            setTimeout(() => consumer.nack(message, false, true), 2000);
          },
        );
      });
    } catch (error) {
      console.error("rabbitmq setup failed:", error instanceof Error ? error.message : error);
      await connection.close().catch(() => undefined);
    }
  };
  void run();
}

async function send(queue: string, body: object, messageId: string): Promise<boolean> {
  const channel = publisher;
  if (!channel) return false;
  try {
    channel.sendToQueue(queue, Buffer.from(JSON.stringify(body)), { persistent: true, messageId, contentType: "application/json" });
    await channel.waitForConfirms();
    return true;
  } catch (error) {
    console.error(`publish to ${queue} failed:`, error instanceof Error ? error.message : error);
    return false;
  }
}

export const publishJob = (job: RenderJob): Promise<boolean> => send(QUEUE, job, job.render_id);

export const publishDead = (job: RenderJob, failureReason: string): Promise<boolean> =>
  send(DEAD, { ...job, failure_reason: failureReason }, job.render_id);

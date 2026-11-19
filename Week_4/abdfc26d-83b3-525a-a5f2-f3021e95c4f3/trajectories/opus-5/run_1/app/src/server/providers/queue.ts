import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { config, deadLetterQueue } from '../config.js';

export interface RenderJobMessage {
  readonly render_id: string;
  readonly piece_slug: string;
  readonly attempt: number;
}

export interface DeadRenderJob extends RenderJobMessage {
  readonly failure_reason: string;
}

let connecting: Promise<Channel> | null = null;
let channel: Channel | null = null;
let consuming = false;

async function openChannel(): Promise<Channel> {
  const connection: ChannelModel = await amqp.connect(config.amqpUrl);
  const forget = (): void => {
    channel = null;
    connecting = null;
    consuming = false;
  };
  connection.on('error', forget);
  connection.on('close', forget);

  const open = await connection.createChannel();
  await open.assertQueue(config.renderQueue, { durable: true });
  await open.assertQueue(deadLetterQueue, { durable: true });
  await open.prefetch(4);
  channel = open;
  return open;
}

async function getChannel(): Promise<Channel> {
  if (channel) return channel;
  if (!connecting) {
    connecting = openChannel().catch((error) => {
      connecting = null;
      throw error;
    });
  }
  return connecting;
}

/** Render jobs are persistent messages whose message_id is the render id. */
export async function publishRenderJob(job: RenderJobMessage): Promise<void> {
  const open = await getChannel();
  open.sendToQueue(config.renderQueue, Buffer.from(JSON.stringify(job), 'utf8'), {
    persistent: true,
    messageId: job.render_id,
    contentType: 'application/json',
  });
}

/** Jobs out of retries wait here for the founder's Renders tab. */
export async function publishDeadRenderJob(job: DeadRenderJob): Promise<void> {
  const open = await getChannel();
  open.sendToQueue(deadLetterQueue, Buffer.from(JSON.stringify(job), 'utf8'), {
    persistent: true,
    messageId: job.render_id,
    contentType: 'application/json',
  });
}

export type RenderJobHandler = (job: RenderJobMessage) => Promise<void>;

/**
 * Subscribes this instance to the render queue once, re-subscribing only after a
 * lost connection. Consumers acknowledge manually, after the job's state change
 * is committed.
 */
export async function consumeRenderJobs(handle: RenderJobHandler): Promise<void> {
  if (consuming) return;
  const open = await getChannel();
  consuming = true;
  await open.consume(config.renderQueue, (message: ConsumeMessage | null) => {
    if (!message) return;
    void (async () => {
      try {
        const job = JSON.parse(message.content.toString('utf8')) as RenderJobMessage;
        await handle(job);
      } catch (error) {
        process.stderr.write(`render job failed: ${String(error)}\n`);
      } finally {
        try {
          open.ack(message);
        } catch {
          // The channel went away; RabbitMQ will redeliver and the redelivery rule applies.
        }
      }
    })();
  });
}

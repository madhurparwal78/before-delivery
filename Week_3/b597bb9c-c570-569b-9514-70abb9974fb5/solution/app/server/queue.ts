import amqp, { type ChannelModel, type ConfirmChannel, type ConsumeMessage } from "amqplib";
import { config } from "./config";

export interface ExportMessage {
  export_id: string;
  project_id: string;
  cut_id: string;
  size: number;
  requested_by: string;
}

const CONNECT_TIMEOUT_MS = 1500;
const RETRY_MS = 2000;

/** The durable export queue: publishes with confirms, consumes with acknowledgements, reconnects without a restart. */
class ExportQueue {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private connecting: Promise<boolean> | null = null;
  private handler: ((message: ExportMessage) => Promise<void>) | null = null;

  start(handler: (message: ExportMessage) => Promise<void>): void {
    this.handler = handler;
    void this.ensure();
    setInterval(() => void this.ensure(), RETRY_MS).unref();
  }

  /** Connects when down; true when a channel is open afterwards. */
  ensure(): Promise<boolean> {
    if (this.channel) return Promise.resolve(true);
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<boolean> {
    try {
      const connection = await Promise.race([
        amqp.connect(config.amqpUrl),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("amqp connect timeout")), CONNECT_TIMEOUT_MS)),
      ]);
      const channel = await connection.createConfirmChannel();
      await channel.assertQueue(config.exportQueue, { durable: true });
      await channel.prefetch(4);
      const lost = (): void => {
        if (this.connection === connection) {
          this.connection = null;
          this.channel = null;
        }
      };
      connection.on("close", lost);
      connection.on("error", lost);
      channel.on("close", lost);
      channel.on("error", lost);
      this.connection = connection;
      this.channel = channel;
      await channel.consume(config.exportQueue, (message) => void this.deliver(channel, message), { noAck: false });
      return true;
    } catch {
      this.channel = null;
      this.connection = null;
      return false;
    }
  }

  private async deliver(channel: ConfirmChannel, message: ConsumeMessage | null): Promise<void> {
    if (!message || !this.handler) return;
    try {
      await this.handler(JSON.parse(message.content.toString("utf8")) as ExportMessage);
      channel.ack(message);
    } catch {
      try {
        channel.nack(message, false, true);
      } catch {
        // the channel closed while the job ran; the broker redelivers
      }
    }
  }

  /** Publishes one persistent message and waits for the broker's confirm; false when the queue is unreachable. */
  async publish(message: ExportMessage): Promise<boolean> {
    if (!(await this.ensure()) || !this.channel) return false;
    try {
      this.channel.sendToQueue(config.exportQueue, Buffer.from(JSON.stringify(message)), { persistent: true, contentType: "application/json" });
      await this.channel.waitForConfirms();
      return true;
    } catch {
      this.channel = null;
      return false;
    }
  }

  async close(): Promise<void> {
    await this.connection?.close().catch(() => undefined);
  }
}

export const exportQueue = new ExportQueue();

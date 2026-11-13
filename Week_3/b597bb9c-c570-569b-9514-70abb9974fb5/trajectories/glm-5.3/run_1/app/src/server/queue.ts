import * as amqp from 'amqplib';
import type { AppConfig } from './config';

type Channel = amqp.Channel;
interface ChannelModel {
  createChannel(): Promise<Channel>;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

export interface ExportMessage {
  export_id: string;
  project_id: string;
  cut_id: string;
  size: number;
  requested_by: string;
}

/**
 * RabbitMQ: the durable export queue. Publishing and consuming report
 * liveness so an export request can answer 503 while the queue is down.
 */
export class Queue {
  private url: string;
  private queueName: string;
  private conn: ChannelModel | null = null;
  private channel: Channel | null = null;
  private up = false;
  private connecting: Promise<void> | null = null;
  private handler: ((msg: ExportMessage) => Promise<void>) | null = null;

  constructor(config: AppConfig) {
    this.url = config.amqpUrl;
    this.queueName = config.exportQueue;
  }

  isUp(): boolean {
    return this.up;
  }

  async connect(handler: (msg: ExportMessage) => Promise<void>): Promise<void> {
    this.handler = handler;
    await this.reconnect();
  }

  private async reconnect(): Promise<void> {
    if (this.connecting !== null) return this.connecting;
    this.connecting = (async () => {
      try {
        this.conn = (await amqp.connect(this.url)) as unknown as ChannelModel;
        this.conn.on('error', () => {
          this.up = false;
        });
        this.conn.on('close', () => {
          this.up = false;
          this.channel = null;
          this.conn = null;
          void this.scheduleReconnect();
        });
        const model = this.conn;
        const channel = await model.createChannel();
        this.channel = channel;
        await channel.assertQueue(this.queueName, { durable: true });
        this.up = true;
        await channel.prefetch(1);
        await this.consume();
      } catch {
        this.up = false;
        this.conn = null;
        this.channel = null;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  private reconnectTimer: NodeJS.Timeout | null = null;

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, 2000);
  }

  /** Try to re-establish the channel if it is down. Returns liveness. */
  async ensure(): Promise<boolean> {
    if (this.up) return true;
    await this.reconnect();
    return this.up;
  }

  private async consume(): Promise<void> {
    if (this.channel === null || this.handler === null) return;
    const channel = this.channel;
    await channel.consume(this.queueName, (msg) => {
      if (msg === null) return;
      const body = JSON.parse(msg.content.toString()) as ExportMessage;
      // A worker failure marks the export failed; the message is still
      // acknowledged so it is not redelivered forever.
      void this.handler!(body)
        .then(() => channel.ack(msg))
        .catch(() => channel.ack(msg));
    }, { noAck: false });
  }

  async publish(msg: ExportMessage): Promise<void> {
    if (!this.up) throw new Error('queue down');
    if (this.channel === null) throw new Error('queue down');
    await this.channel.sendToQueue(this.queueName, Buffer.from(JSON.stringify(msg)), {
      persistent: true,
    });
  }
}

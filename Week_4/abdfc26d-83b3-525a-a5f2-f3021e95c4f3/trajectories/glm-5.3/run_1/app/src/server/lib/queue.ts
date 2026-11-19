import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
import { config } from '../../config.js';

export interface RenderJobMessage {
  render_id: string;
  piece_slug: string;
  attempt: number;
}

export interface RenderDeadMessage extends RenderJobMessage {
  failure_reason: string;
}

export class RenderQueue {
  private connection: Connection | null = null;
  private channel: amqp.Channel | null = null;
  private instanceId = randomUUID();
  private connecting: Promise<void> | null = null;

  async connect(): Promise<void> {
    if (this.channel) return;
    if (this.connecting) return this.connecting;
    const connect = (async () => {
      try {
        const conn = await amqp.connect(config.amqpUrl);
        const ch = await conn.createChannel();
        await ch.assertQueue(config.renderQueue, { durable: true });
        await ch.assertQueue(`${config.renderQueue}.dead`, { durable: true });
        this.connection = conn;
        this.channel = ch;
        ;(conn as unknown as { on: (e: string, f: () => void) => void }).on('error', () => { this.connection = null; this.channel = null; });
        ;(conn as unknown as { on: (e: string, f: () => void) => void }).on('close', () => { this.connection = null; this.channel = null; });
      } catch {
        this.connecting = null;
        throw new Error('amqp_unreachable');
      } finally {
        this.connecting = null;
      }
    })();
    this.connecting = connect;
    return connect;
  }

  private async withChannel<T>(fn: (ch: amqp.Channel) => Promise<T>): Promise<T> {
    await this.connect();
    const ch = this.channel;
    if (!ch) throw new Error('amqp_unreachable');
    return fn(ch);
  }

  async disconnect(): Promise<void> {
    await this.connection?.close();
    this.connection = null;
    this.channel = null;
  }

  async publish(message: RenderJobMessage): Promise<void> {
    await this.withChannel(async (ch) => {
      await ch.sendToQueue(config.renderQueue, Buffer.from(JSON.stringify(message)), {
        persistent: true,
        messageId: message.render_id
      });
    });
  }

  async publishDead(message: RenderDeadMessage): Promise<void> {
    await this.withChannel(async (ch) => {
      await ch.sendToQueue(`${config.renderQueue}.dead`, Buffer.from(JSON.stringify(message)), { persistent: true, messageId: message.render_id });
    });
  }

  async consume(handler: (msg: RenderJobMessage, ack: () => void) => void): Promise<void> {
    await this.withChannel(async (ch) => {
      await ch.consume(config.renderQueue, (raw) => {
        if (!raw) return;
        let message: RenderJobMessage;
        try {
          message = JSON.parse(raw.content.toString('utf8')) as RenderJobMessage;
        } catch {
          ch.reject(raw, false);
          return;
        }
        handler(message, () => ch.ack(raw));
      }, { noAck: false });
    });
  }

  async probe(): Promise<boolean> {
    try {
      await this.connect();
      return this.channel !== null;
    } catch {
      return false;
    }
  }

  id(): string {
    return this.instanceId;
  }
}

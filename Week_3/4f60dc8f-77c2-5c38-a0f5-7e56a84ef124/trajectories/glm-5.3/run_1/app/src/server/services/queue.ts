import amqp from 'amqplib';
import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import type { AppConfig } from '../config';

export const MEASURE_QUEUE = 'intake.measure';
export const MEASURE_DEAD_QUEUE = 'intake.measure.dead';

type MessageHandler = (message: ConsumeMessage) => Promise<'ack' | 'retry' | 'dead'>;

export class MeasureQueue {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private connecting = false;
  private readonly config: AppConfig;
  private handler: MessageHandler | null = null;
  private consumerTag: string | null = null;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async healthy(): Promise<boolean> {
    try {
      const conn = await amqp.connect(this.config.amqpUrl);
      await conn.close();
      return true;
    } catch {
      return false;
    }
  }

  private async ensure(): Promise<Channel> {
    if (this.channel) {
      return this.channel;
    }
    if (this.connecting) {
      throw new Error('unreachable');
    }
    this.connecting = true;
    try {
      const connection = await amqp.connect(this.config.amqpUrl);
      this.connection = connection;
      connection.on('error', () => {
        this.connection = null;
        this.channel = null;
        this.consumerTag = null;
      });
      connection.on('close', () => {
        this.connection = null;
        this.channel = null;
        this.consumerTag = null;
      });
      const channel = await connection.createChannel();
      await channel.assertQueue(MEASURE_QUEUE, { durable: true });
      await channel.assertQueue(MEASURE_DEAD_QUEUE, { durable: true });
      this.channel = channel;
      if (this.handler) {
        await this.startConsumer(channel);
      }
      return channel;
    } catch {
      this.connection = null;
      this.channel = null;
      throw new Error('unreachable');
    } finally {
      this.connecting = false;
    }
  }

  async publish(fileId: string): Promise<void> {
    const channel = await this.ensure();
    channel.sendToQueue(MEASURE_QUEUE, Buffer.from(JSON.stringify({ intake_file_id: fileId })), { persistent: true });
  }

  async publishDead(fileId: string): Promise<void> {
    const channel = await this.ensure();
    channel.sendToQueue(MEASURE_DEAD_QUEUE, Buffer.from(JSON.stringify({ intake_file_id: fileId })), { persistent: true });
  }

  setHandler(handler: MessageHandler): void {
    this.handler = handler;
    if (this.channel && !this.consumerTag) {
      void this.startConsumer(this.channel);
    }
  }

  private async startConsumer(channel: Channel): Promise<void> {
    if (this.consumerTag || !this.handler) {
      return;
    }
    const handler = this.handler;
    const tag = await channel.consume(MEASURE_QUEUE, (message) => {
      if (!message) {
        this.consumerTag = null;
        return;
      }
      void (async () => {
        try {
          const result = await handler(message);
          if (result === 'ack') {
            channel.ack(message);
          } else if (result === 'dead') {
            const body = message.content.toString();
            channel.sendToQueue(MEASURE_DEAD_QUEUE, Buffer.from(body), { persistent: true });
            channel.ack(message);
          } else {
            channel.reject(message, true);
          }
        } catch {
          channel.reject(message, true);
        }
      })();
    }, { noAck: false });
    this.consumerTag = tag.consumerTag;
  }
}

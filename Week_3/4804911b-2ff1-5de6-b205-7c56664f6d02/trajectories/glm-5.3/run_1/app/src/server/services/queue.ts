import amqp from 'amqplib';
import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib';

export interface JobBody {
  jobId: string;
  kind: 'render' | 'index' | 'send';
  [k: string]: unknown;
}

export type JobHandler = (job: JobBody) => Promise<void>;

/**
 * The durable work queue carries background work from the Postgres outbox to
 * separate workers, with manual acknowledgements and publisher confirms.
 */
export class WorkQueue {
  private conn: ChannelModel | null = null;
  private channel: Channel | null = null;
  private workQueue = '';
  private deadQueue = '';
  private handlers = new Map<string, JobHandler>();
  private lastContactOk = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private amqpUrl: string, private connectAddress: string | null, private copyId: string) {}

  on(kind: string, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  private urlWithAddress(): string {
    if (!this.connectAddress) return this.amqpUrl;
    try {
      const u = new URL(this.amqpUrl);
      const [host, port] = this.connectAddress.split(':');
      u.hostname = host;
      if (port) u.port = port;
      return u.toString();
    } catch {
      return this.amqpUrl;
    }
  }

  private async connect(): Promise<void> {
    const conn = await amqp.connect(this.urlWithAddress());
    // An unhandled connection error never ends the process.
    conn.on('error', () => this.onConnectionLost());
    conn.on('close', () => this.onConnectionLost());
    const ch = await conn.createChannel();
    this.workQueue = `interval.${this.copyId}.work`;
    this.deadQueue = `interval.${this.copyId}.dead`;
    await ch.assertQueue(this.workQueue, { durable: true });
    await ch.assertQueue(this.deadQueue, { durable: true });
    await ch.prefetch(4);
    this.conn = conn;
    this.channel = ch;
    this.lastContactOk = true;
    await ch.consume(this.workQueue, (msg) => void this.handleMessage(ch, msg));
  }

  private onConnectionLost(): void {
    if (this.stopped) return;
    this.conn = null;
    this.channel = null;
    this.lastContactOk = false;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.tryConnect();
    }, 3000);
  }

  async tryConnect(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.connect();
    } catch {
      this.lastContactOk = false;
      this.scheduleReconnect();
    }
  }

  get reachable(): boolean {
    return this.lastContactOk && this.channel !== null;
  }

  async contactCheck(): Promise<boolean> {
    if (this.channel) return true;
    await this.tryConnect();
    return this.reachable;
  }

  private async handleMessage(ch: Channel, msg: ConsumeMessage | null): Promise<void> {
    if (!msg) return;
    let job: JobBody | null = null;
    try {
      job = JSON.parse(msg.content.toString()) as JobBody;
    } catch {
      job = null;
    }
    if (!job || typeof job.jobId !== 'string' || typeof job.kind !== 'string') {
      await ch.sendToQueue(this.deadQueue, msg.content, { persistent: true });
      ch.nack(msg, false, false);
      this.onBroken?.('unparseable job body');
      return;
    }
    const handler = this.handlers.get(job.kind);
    if (!handler) {
      await ch.sendToQueue(this.deadQueue, msg.content, { persistent: true });
      ch.nack(msg, false, false);
      this.onBroken?.(`unknown kind ${job.kind}`);
      return;
    }
    try {
      await handler(job);
      ch.ack(msg);
    } catch (e) {
      if (e instanceof BrokenJobError) {
        await ch.sendToQueue(this.deadQueue, msg.content, { persistent: true });
        ch.nack(msg, false, false);
        this.onBroken?.(e.reason);
      } else {
        // A provider failure is not a broken job: it is never set aside,
        // however long the outage lasts.
        console.error('work failed, retrying', job.kind, job.jobId, e);
        setTimeout(() => ch.nack(msg, false, true), 2000);
      }
    }
  }

  /** Called when a broken job is set aside; the server raises heldWork. */
  onBroken: ((reason: string) => void) | null = null;

  async publish(job: JobBody): Promise<boolean> {
    const ch = this.channel;
    if (!ch) return false;
    try {
      // publisher confirms: the write is confirmed before the relay marks the row done
      await ch.sendToQueue(this.workQueue, Buffer.from(JSON.stringify(job)), { persistent: true });
      this.lastContactOk = true;
      return true;
    } catch {
      this.lastContactOk = false;
      return false;
    }
  }

  async close(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      await this.conn?.close();
    } catch {
      // already closed
    }
  }
}

export class BrokenJobError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

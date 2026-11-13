import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { Config } from './config.js';
import { SmtpClient } from './smtp.js';

export interface ServiceState {
  storage: boolean;
  mail: boolean;
  push: boolean;
}

const CHECK_INTERVAL_MS = 10_000;

export class Storage {
  private client: S3Client;
  private healthy = true;

  constructor(private config: Config) {
    this.client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
    });
  }

  objectKey(boardId: string, postId: string, attachmentId: string): string {
    return `boards/${boardId}/posts/${postId}/${attachmentId}`;
  }

  boardPrefix(boardId: string): string {
    return `boards/${boardId}/`;
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<boolean> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.s3.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      );
      this.healthy = true;
      return true;
    } catch {
      this.healthy = false;
      return false;
    }
  }

  async get(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.s3.bucket, Key: key }));
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(chunk);
      return { bytes: Buffer.concat(chunks), contentType: res.ContentType ?? 'application/octet-stream' };
    } catch {
      this.healthy = false;
      return null;
    }
  }

  async deletePrefix(prefix: string): Promise<boolean> {
    try {
      for (;;) {
        const list = await this.client.send(
          new ListObjectsV2Command({ Bucket: this.config.s3.bucket, Prefix: prefix }),
        );
        const objects = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
        if (objects.length === 0) return true;
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.config.s3.bucket, Delete: { Objects: objects } }));
        if (!list.IsTruncated) return true;
      }
    } catch {
      this.healthy = false;
      return false;
    }
  }

  async check(): Promise<boolean> {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.config.s3.bucket, Key: '__health__', Body: Buffer.alloc(1) }),
      );
      await this.deletePrefix('__health__');
      this.healthy = true;
      return true;
    } catch {
      this.healthy = false;
      return false;
    }
  }
}

export class Mailer {
  private client: SmtpClient;

  constructor(config: Config) {
    this.client = new SmtpClient(config.smtp.host, config.smtp.port);
  }

  send(opts: { to: string; subject: string; text: string }): Promise<boolean> {
    return this.client.send({
      to: opts.to,
      from: this.mailFrom,
      subject: opts.subject,
      text: opts.text,
    });
  }

  private mailFrom = '';

  setFrom(from: string): void {
    this.mailFrom = from;
  }

  check(): Promise<boolean> {
    return this.client.verify();
  }
}

export class Pusher {
  constructor(private config: Config) {}

  async publish(boardId: string, boardTitle: string, postTitle: string): Promise<boolean> {
    const url = `${this.config.ntfy.url.replace(/\/$/, '')}/pinsheet-approvals-${boardId}`;
    const auth = Buffer.from(`${this.config.ntfy.username}:${this.config.ntfy.password}`).toString('base64');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, Title: `Post waiting on ${boardTitle}` },
        body: postTitle,
        signal: AbortSignal.timeout(4000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async check(): Promise<boolean> {
    const auth = Buffer.from(`${this.config.ntfy.username}:${this.config.ntfy.password}`).toString('base64');
    try {
      const res = await fetch(this.config.ntfy.url.replace(/\/$/, '') + '/v1/health', {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(4000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export class Services {
  readonly storage: Storage;
  readonly mail: Mailer;
  readonly push: Pusher;
  state: ServiceState = { storage: true, mail: true, push: true };

  constructor(private config: Config) {
    this.storage = new Storage(config);
    this.mail = new Mailer(config);
    this.mail.setFrom(config.smtp.from);
    this.push = new Pusher(config);
  }

  storageIsUp(): boolean {
    return this.state.storage;
  }

  mailIsUp(): boolean {
    return this.state.mail;
  }

  async checkAll(): Promise<ServiceState> {
    const [storage, mail, push] = await Promise.all([
      this.storage.check(),
      this.mail.check(),
      this.push.check(),
    ]);
    this.state = { storage, mail, push };
    return this.state;
  }

  startChecking(): void {
    const tick = () => {
      void this.checkAll();
    };
    setInterval(tick, CHECK_INTERVAL_MS);
  }
}

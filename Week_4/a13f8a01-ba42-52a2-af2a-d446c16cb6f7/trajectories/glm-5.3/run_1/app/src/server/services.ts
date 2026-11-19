import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { AppConfig } from "../shared/config.js";
import { SHELF } from "../shared/shelf.js";

const require = createRequire(import.meta.url);
const nodemailer = require("nodemailer") as typeof import("nodemailer");
const s3mod = require("@aws-sdk/client-s3") as typeof import("@aws-sdk/client-s3");

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export class MailService {
  private transporter: import("nodemailer").Transporter | null = null;
  private down = false;
  private outbox = new Map<string, MailMessage>();
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(private cfg: AppConfig["smtp"]) {}

  async send(msg: MailMessage): Promise<boolean> {
    try {
      if (!this.transporter) {
        this.transporter = nodemailer.createTransport({ host: this.cfg.host, port: this.cfg.port, connectionTimeout: 4000, greetingTimeout: 4000, socketTimeout: 8000 });
      }
      await this.transporter.sendMail({ from: this.cfg.from, to: msg.to, subject: msg.subject, text: msg.text });
      this.down = false;
      return true;
    } catch {
      this.transporter?.close();
      this.transporter = null;
      this.down = true;
      return false;
    }
  }

  // A notice that could not be sent waits here and is retried until mail accepts it.
  queue(outboxId: string, msg: MailMessage): void {
    this.outbox.set(outboxId, msg);
    this.ensureRetry();
  }

  private ensureRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => void this.retryLoop(), 30000);
    this.retryTimer.unref?.();
  }

  private async retryLoop(): Promise<void> {
    this.retryTimer = null;
    const pending = [...this.outbox.entries()];
    for (const [id, msg] of pending) {
      const ok = await this.send(msg);
      if (ok) this.outbox.delete(id);
      else break;
    }
    if (this.outbox.size > 0) {
      this.retryTimer = setTimeout(() => void this.retryLoop(), 15000);
      this.retryTimer.unref?.();
    } else {
      this.retryTimer = null;
    }
  }

  isDown(): boolean {
    return this.down;
  }
}

export class StorageService {
  private client: import("@aws-sdk/client-s3").S3Client | null = null;
  private down = false;
  private seeded = false;
  private seedPromise: Promise<void> | null = null;

  constructor(private cfg: AppConfig["s3"]) {}

  private s3Client(): import("@aws-sdk/client-s3").S3Client {
    if (!this.client) {
      this.client = new s3mod.S3Client({
        endpoint: this.cfg.endpoint,
        region: this.cfg.region,
        forcePathStyle: this.cfg.forcePathStyle,
        credentials: { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey },
      });
    }
    return this.client;
  }

  async markUp(): Promise<void> {
    this.down = false;
    if (!this.seeded) await this.seedShelf();
  }

  markDown(): void {
    this.down = true;
  }

  isDown(): boolean {
    return this.down;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3Client().send(new s3mod.PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.s3Client().send(new s3mod.GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    const chunks: Buffer[] = [];
    const stream = res.Body as import("node:stream").Readable;
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks);
  }

  async head(key: string): Promise<number | null> {
    try {
      const res = await this.s3Client().send(new s3mod.HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return res.ContentLength ?? 0;
    } catch {
      return null;
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    let token: string | undefined;
    do {
      const list = await this.s3Client().send(new s3mod.ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (list.Contents ?? []).map((o) => o.Key).filter((k): k is string => typeof k === "string");
      if (keys.length > 0) {
        await this.s3Client().send(new s3mod.DeleteObjectsCommand({ Bucket: this.cfg.bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
      }
      token = list.NextContinuationToken;
    } while (token);
  }

  async ping(): Promise<boolean> {
    try {
      await this.s3Client().send(new s3mod.HeadBucketCommand({ Bucket: this.cfg.bucket }));
      await this.markUp();
      return true;
    } catch {
      this.markDown();
      return false;
    }
  }

  private async seedShelf(): Promise<void> {
    if (this.seeded) return;
    if (this.seedPromise) return this.seedPromise;
    this.seedPromise = (async () => {
      for (const entry of SHELF) {
        const key = `shelf/${entry.id}/${entry.file}`;
        if ((await this.head(key)) === null) {
          const path = new URL(`../shelf/${entry.file}`, import.meta.url).pathname;
          if (!existsSync(path)) continue;
          await this.put(key, readFileSync(path), "text/javascript");
        }
      }
      this.seeded = true;
    })().catch(() => {
      this.seedPromise = null;
    });
    return this.seedPromise;
  }
}

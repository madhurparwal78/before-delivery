// Storage (MinIO) and mail (SMTP) clients with health that reflects real
// calls. No self-reported success: every state comes from the service itself.
import { Client as MinioClient } from 'minio';
import nodemailer from 'nodemailer';

export interface StorageApi {
  status(): 'up' | 'down';
  put(key: string, bytes: Buffer): Promise<void>;
  head(key: string): Promise<number | null>;
  remove(key: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class MinioStorage implements StorageApi {
  private client: MinioClient;
  private bucket: string;
  private healthy = false;

  constructor(endpoint: string, region: string, bucket: string, accessKey: string, secretKey: string, _forcePathStyle: boolean) {
    const url = new URL(endpoint);
    this.client = new MinioClient({ endPoint: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), useSSL: url.protocol === 'https:', accessKey, secretKey, region });
    this.bucket = bucket;
  }

  status(): 'up' | 'down' {
    return this.healthy ? 'up' : 'down';
  }

  async check(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) await this.client.makeBucket(this.bucket);
      this.healthy = true;
    } catch {
      this.healthy = false;
    }
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    await this.client.putObject(this.bucket, key, bytes, bytes.length, { 'Content-Type': 'video/mp4' });
  }

  async head(key: string): Promise<number | null> {
    try {
      const stat = await this.client.statObject(this.bucket, key);
      return typeof stat.size === 'number' ? stat.size : null;
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, key);
    } catch {
      // Removing a missing object is fine.
    }
  }

  async get(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }
}

class Mailer {
  transport: import('nodemailer').Transporter;
  up = false;
  from: string;

  constructor(host: string, port: number, from: string) {
    this.transport = nodemailer.createTransport({ host, port, secure: false, tls: { rejectUnauthorized: false } });
    this.from = from;
  }

  status(): 'up' | 'down' {
    return this.up ? 'up' : 'down';
  }

  async check(): Promise<void> {
    return new Promise((resolve) => {
      this.transport.verify((err: Error | null) => {
        this.up = err === null;
        resolve();
      });
    });
  }

  async send(msg: { from: string; to: string; subject: string; text: string; headers: Record<string, string> }): Promise<void> {
    await this.transport.sendMail(msg as import('nodemailer').SendMailOptions);
  }
}

let storageInstance: MinioStorage | null = null;
let mailerInstance: Mailer | null = null;

export function initStorage(cfg: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string }): void {
  storageInstance = new MinioStorage(cfg.endpoint, cfg.region, cfg.bucket, cfg.accessKeyId, cfg.secretAccessKey, cfg.forcePathStyle);
}

export function initMailer(cfg: { host: string; port: number; from: string }): void {
  mailerInstance = new Mailer(cfg.host, cfg.port, cfg.from);
}

export function getStorage(): MinioStorage {
  if (!storageInstance) throw new Error('storage not initialised');
  return storageInstance;
}

export const storage = {
  status: (): 'up' | 'down' => storageInstance?.status() ?? 'down',
  check: async (): Promise<void> => storageInstance?.check(),
  put: (key: string, bytes: Buffer): Promise<void> => storageInstance!.put(key, bytes),
  head: (key: string): Promise<number | null> => storageInstance!.head(key),
  remove: (key: string): Promise<void> => storageInstance!.remove(key),
  get: (key: string): Promise<Buffer> => storageInstance!.get(key),
};

export const mailer = {
  get up(): boolean { return mailerInstance?.up ?? false; },
  status: (): 'up' | 'down' => mailerInstance?.status() ?? 'down',
  check: async (): Promise<void> => mailerInstance?.check(),
  send: (msg: { from: string; to: string; subject: string; text: string; headers: Record<string, string> }): Promise<void> => mailerInstance!.send(msg),
  get from(): string { return mailerInstance!.from; },
};

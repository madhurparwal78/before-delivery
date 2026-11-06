import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { connect } from 'node:net';
import type { Readable } from 'node:stream';

export interface Config {
  databaseUrl: string;
  s3: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };
  killbill: { url: string; username: string; password: string; apiKey: string; apiSecret: string };
  smtp: { host: string; port: number };
  mailFrom: string;
  appPublicUrl: string;
  port: number;
  sessionTtlSeconds: number;
  previewLinkTtlSeconds: number;
  optInLinkTtlSeconds: number;
  waitlistRateWindowSeconds: number;
  inviteLinkTtlSeconds: number;
  resetLinkTtlSeconds: number;
}

function num(env: string | undefined, fallback: number): number {
  const n = Number(env);
  return Number.isFinite(n) && env !== undefined && env !== '' ? n : fallback;
}

// Every provider URL and credential is read from the environment at start.
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const port = num(env.APP_PUBLIC_PORT, 4173);
  return {
    databaseUrl: env.DATABASE_URL ?? '',
    s3: {
      endpoint: env.S3_ENDPOINT ?? '',
      region: env.S3_REGION ?? 'us-east-1',
      bucket: env.S3_BUCKET ?? '',
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? ''
    },
    killbill: {
      url: env.KILLBILL_URL ?? '',
      username: env.KILLBILL_USERNAME ?? '',
      password: env.KILLBILL_PASSWORD ?? '',
      apiKey: env.KILLBILL_API_KEY ?? '',
      apiSecret: env.KILLBILL_API_SECRET ?? ''
    },
    smtp: { host: env.SMTP_HOST ?? 'localhost', port: num(env.SMTP_PORT, 1025) },
    mailFrom: env.MAIL_FROM ?? 'Hourline <launch@hourline.example>',
    appPublicUrl: env.APP_PUBLIC_URL ?? `http://127.0.0.1:${port}`,
    port,
    sessionTtlSeconds: num(env.SESSION_TTL_SECONDS, 28800),
    previewLinkTtlSeconds: num(env.PREVIEW_LINK_TTL_SECONDS, 604800),
    optInLinkTtlSeconds: num(env.OPT_IN_LINK_TTL_SECONDS, 86400),
    waitlistRateWindowSeconds: num(env.WAITLIST_RATE_WINDOW_SECONDS, 600),
    inviteLinkTtlSeconds: num(env.INVITE_LINK_TTL_SECONDS, 604800),
    resetLinkTtlSeconds: num(env.RESET_LINK_TTL_SECONDS, 3600)
  };
}

export class Storage {
  readonly client: S3Client;
  readonly bucket: string;
  constructor(cfg: Config['s3']) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
    });
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }
  async del(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

// A minimal SMTP client speaking plain SMTP over a socket, used for Mailpit.
// Bodies are plain text with absolute links built from APP_PUBLIC_URL.
export class Mailer {
  constructor(private readonly cfg: Config, private readonly mailFrom: string) {}

  async send(to: string, subject: string, body: string): Promise<void> {
    const socket = connect({ host: this.cfg.smtp.host, port: this.cfg.smtp.port });
    const read = new Promise<Buffer>(resolve => {
      const chunks: Buffer[] = [];
      socket.on('data', (c: Buffer) => chunks.push(c));
      socket.on('end', () => resolve(Buffer.concat(chunks)));
      socket.on('close', () => resolve(Buffer.concat(chunks)));
    });
    const opened = new Promise<void>(resolve => socket.on('connect', resolve));
    await opened;
    const commands: { cmd: string; expect: number }[] = [
      { cmd: '', expect: 220 },
      { cmd: `HELO hourline`, expect: 250 },
      { cmd: `MAIL FROM:<${this.smtpAddress(this.mailFrom)}>`, expect: 250 },
      { cmd: `RCPT TO:<${this.smtpAddress(to)}>`, expect: 250 },
      { cmd: `DATA`, expect: 354 }
    ];
    let sent = false;
    for (let i = 0; i < commands.length; i++) {
      const { cmd, expect } = commands[i];
      if (cmd !== '') {
        socket.write(cmd + '\r\n');
        await this.readResponse(socket, expect);
      } else {
        await this.readResponse(socket, expect);
      }
    }
    const headers = [
      `From: ${this.mailFrom}`,
      `To: ${to}`,
      `Subject: ${subject.replace(/[\r\n]+/g, ' ')}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      ''
    ].join('\r\n');
    const safeBody = body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    socket.write(headers + '\r\n' + safeBody + '\r\n.\r\n');
    await this.readResponse(socket, 250);
    sent = true;
    socket.write('QUIT\r\n');
    void read;
    socket.end();
    if (!sent) throw new Error('smtp send incomplete');
  }

  private smtpAddress(from: string): string {
    const m = /<([^>]+)>/.exec(from);
    return m ? m[1] : from;
  }

  private readResponse(socket: import('node:net').Socket, expect: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString('utf8');
        const m = /^(\d{3})([ -])/.exec(buffer);
        if (m && m[2] === ' ') {
          const code = Number(m[1]);
          socket.removeListener('data', onData);
          if (code === expect) resolve();
          else reject(new Error(`smtp expected ${expect}, got ${code}`));
        }
      };
      socket.on('data', onData);
      socket.once('error', reject);
    });
  }
}

export class KillBill {
  constructor(private readonly cfg: Config['killbill']) {}
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const basic = Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString('base64');
    return {
      Authorization: `Basic ${basic}`,
      'X-Killbill-ApiKey': this.cfg.apiKey,
      'X-Killbill-ApiSecret': this.cfg.apiSecret,
      'Content-Type': 'application/json',
      ...extra
    };
  }
  private base(): string {
    // Kill Bill serves its API under /1.0/kb on this deployment.
    return `${this.cfg.url.replace(/\/$/, '')}/1.0/kb`;
  }
  async ensureAccount(externalKey: string, name: string, currency: string): Promise<string> {
    let res = await fetch(`${this.base()}/accounts?externalKey=${encodeURIComponent(externalKey)}`, { headers: this.headers() });
    if (res.status === 200) {
      const acct = await res.json() as { accountId: string };
      return acct.accountId;
    }
    const created = await fetch(`${this.base()}/accounts`, {
      method: 'POST',
      headers: { ...this.headers(), 'X-Killbill-CreatedBy': 'hourline' },
      body: JSON.stringify({ name, externalKey, currency })
    });
    if (!created.ok && created.status !== 201) throw new Error(`killbill account failed: ${created.status}`);
    const loc = created.headers.get('location');
    if (loc) {
      const accountId = loc.split('/').pop()!.split('?')[0];
      if (/^[0-9a-f-]{36}$/.test(accountId)) return accountId;
      const found = await fetch(`${this.base()}/accounts?externalKey=${encodeURIComponent(externalKey)}`, { headers: this.headers() });
      const acct = await found.json() as { accountId: string };
      return acct.accountId;
    }
    res = await fetch(`${this.base()}/accounts?externalKey=${encodeURIComponent(externalKey)}`, { headers: this.headers() });
    const acct = await res.json() as { accountId: string };
    return acct.accountId;
  }
  async createInvoice(accountId: string, currency: string, items: { description: string; amount: string }[]): Promise<{ invoiceId: string; invoiceNumber: string }> {
    // External charges on the account's invoice, committed at once.
    const res = await fetch(`${this.base()}/invoices/charges/${accountId}?autoCommit=true`, {
      method: 'POST',
      headers: { ...this.headers(), 'X-Killbill-CreatedBy': 'hourline' },
      body: JSON.stringify(items.map(i => ({ description: i.description, amount: Number(i.amount), currency })))
    });
    if (!res.ok) throw new Error(`killbill invoice failed: ${res.status}`);
    const created = await res.json() as { invoiceId: string }[];
    const invoiceId = created[0].invoiceId;
    const invoice = await fetch(`${this.base()}/invoices/${invoiceId}`, { headers: this.headers() });
    if (!invoice.ok) throw new Error(`killbill invoice fetch failed: ${invoice.status}`);
    const body = await invoice.json() as { invoiceNumber: string };
    return { invoiceId, invoiceNumber: String(body.invoiceNumber) };
  }
}

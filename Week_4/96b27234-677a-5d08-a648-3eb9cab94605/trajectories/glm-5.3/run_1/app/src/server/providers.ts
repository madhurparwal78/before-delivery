// MinIO S3 client (signature v4) and Valkey (RESP) client, written directly so
// the app talks to the four services with real provider calls and credentials
// read only from the environment.
import { createHmac, createHash } from 'crypto';
import http from 'http';
import net from 'net';
import { config } from './config';

export class S3 {
  private host: string;
  private port: number;

  constructor() {
    const u = new URL(config.s3.endpoint);
    this.host = u.hostname;
    this.port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  }

  request(method: string, key: string, body: Buffer | null): Promise<{ status: number; data: Buffer }> {
    const u = new URL(config.s3.endpoint);
    const hostHeader = `${u.hostname}${u.port ? `:${u.port}` : ''}`;
    const canonicalUri = `/${config.s3.bucket}/${key}`
      .split('/')
      .map((part, i) => (i === 0 ? part : encodeURIComponent(part)))
      .join('/');
    const payloadHash = createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex');
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const headers: Record<string, string> = {
      host: hostHeader,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const signedList = Object.keys(headers).sort();
    const canonicalHeaders = signedList.map((h) => `${h}:${headers[h]}\n`).join('');
    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedList.join(';'), payloadHash].join('\n');
    const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const kDate = createHmac('sha256', `AWS4${config.s3.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(config.s3.region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedList.join(';')}, Signature=${signature}`;
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: this.host,
          port: this.port,
          method,
          path: canonicalUri,
          headers: {
            ...headers,
            Authorization: authorization,
            'Content-Type': 'model/gltf-binary',
            'Content-Length': body ? body.length : 0,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, data: Buffer.concat(chunks) }));
        }
      );
      req.setTimeout(5000, () => { req.destroy(new Error('S3 timeout')); });
      req.on('error', reject);
      if (body && body.length) req.write(body);
      req.end();
    });
  }

  async ensureBucket(): Promise<void> {
    const res = await this.request('PUT', '', Buffer.alloc(0));
    if (res.status !== 200) throw new Error(`bucket ensure ${res.status}`);
  }

  async put(key: string, body: Buffer): Promise<void> {
    const res = await this.request('PUT', key, body);
    if (res.status !== 200) throw new Error(`put ${res.status}`);
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.request('GET', key, null);
    if (res.status === 404) throw new Error('NoSuchKey');
    if (res.status !== 200) throw new Error(`get ${res.status}`);
    return res.data;
  }

  async delete(key: string): Promise<void> {
    const res = await this.request('DELETE', key, null);
    if (res.status !== 204 && res.status !== 200 && res.status !== 404) throw new Error(`delete ${res.status}`);
  }
}

type Frame =
  | { kind: 'status' | 'error' | 'integer' | 'bulk'; items: string[] }
  | { kind: 'array' | 'push'; items: string[] };

// A small RESP client for Valkey. Pushed subscribe frames can interleave with
// replies on the same socket, so a dedicated socket carries subscriptions.
export class Valkey {
  private buf = Buffer.alloc(0);
  private sock: net.Socket | null = null;
  private ready = false;
  private repliers: { resolve: (v: unknown) => void; reject: (e: Error) => void }[] = [];
  private subs = new Map<string, (msg: string) => void>();
  private subSock: net.Socket | null = null;
  private subBuf = Buffer.alloc(0);
  private connecting = false;

  constructor() {
    this.open();
  }

  private open(): void {
    if (this.connecting) return;
    this.connecting = true;
    const u = new URL(config.valkeyUrl);
    const s = net.createConnection({ host: u.hostname, port: Number(u.port) || 6379 });
    s.setNoDelay(true);
    const username = decodeURIComponent(u.username || '');
    const password = decodeURIComponent(u.password || '');
    s.on('connect', () => {
      this.sock = s;
      this.ready = true;
      if (password) {
        s.write(username ? this.pack(['AUTH', username, password]) : this.pack(['AUTH', password]));
      }
    });
    s.on('data', (chunk) => { this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk; this.drain(); });
    s.on('close', () => {
      if (this.sock === s) {
        this.sock = null;
        this.ready = false;
        const err = new Error('Valkey unavailable');
        this.repliers.forEach((r) => r.reject(err));
        this.repliers = [];
        this.connecting = false;
        this.open();
      }
    });
    s.on('error', () => {});
  }

  private drain(): void {
    let frame: Frame | null;
    while ((frame = this.parse()) !== null) {
      const r = this.repliers.shift();
      if (!r) continue;
      if (frame.kind === 'error') r.reject(new Error('valkey: ' + frame.items[0]));
      else if (frame.kind === 'array') r.resolve(frame.items);
      else r.resolve(frame.items[0]);
    }
  }

  private parse(): Frame | null {
    const buf = this.buf;
    if (buf.length < 1) return null;
    const c = buf[0];
    const lineEnd = buf.indexOf('\r\n');
    if (lineEnd < 0) return null;
    if (c === 0x2b || c === 0x2d || c === 0x3a) {
      const payload = buf.toString('utf8', 1, lineEnd);
      this.buf = buf.subarray(lineEnd + 2);
      if (c === 0x2b) return { kind: 'status', items: [payload] };
      if (c === 0x2d) return { kind: 'error', items: [payload] };
      return { kind: 'integer', items: [payload] };
    }
    if (c === 0x24) {
      const len = parseInt(buf.toString('utf8', 1, lineEnd), 10);
      if (buf.length < lineEnd + 2 + len + 2) return null;
      const payload = buf.toString('utf8', lineEnd + 2, lineEnd + 2 + len);
      this.buf = buf.subarray(lineEnd + 2 + len + 2);
      return { kind: 'bulk', items: [payload] };
    }
    if (c === 0x2a) {
      const count = parseInt(buf.toString('utf8', 1, lineEnd), 10);
      let pos = lineEnd + 2;
      const items: string[] = [];
      for (let i = 0; i < count; i++) {
        if (pos >= buf.length) return null;
        const t = buf[pos];
        const le = buf.indexOf('\r\n', pos);
        if (le < 0) return null;
        if (t === 0x24) {
          const len = parseInt(buf.toString('utf8', pos + 1, le), 10);
          if (buf.length < le + 2 + len + 2) return null;
          items.push(buf.toString('utf8', le + 2, le + 2 + len));
          pos = le + 2 + len + 2;
        } else if (t === 0x3a || t === 0x2b || t === 0x2d) {
          items.push(buf.toString('utf8', pos + 1, le));
          pos = le + 2;
        } else {
          return null;
        }
      }
      this.buf = buf.subarray(pos);
      return { kind: 'array', items };
    }
    this.buf = buf.subarray(lineEnd + 2);
    return { kind: 'push', items: [] };
  }

  private pack(args: (string | number)[]): Buffer {
    const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
    for (const a of args) {
      const s = String(a);
      parts.push(Buffer.from(`$${Buffer.byteLength(s)}\r\n${s}\r\n`));
    }
    return Buffer.concat(parts);
  }

  private call(args: (string | number)[]): Promise<unknown> {
    if (!this.sock || !this.ready) return Promise.reject(new Error('Valkey unavailable'));
    return new Promise((resolve, reject) => {
      this.repliers.push({ resolve, reject });
      this.sock!.write(this.pack(args));
    });
  }

  async command(cmd: string, ...args: (string | number)[]): Promise<unknown> {
    return this.call([cmd, ...args]);
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.call(['PUBLISH', channel, message]);
  }

  async subscribe(channel: string, listener: (msg: string) => void): Promise<void> {
    this.subs.set(channel, listener);
    if (this.subSock) {
      this.subSock.write(this.pack(['SUBSCRIBE', channel]));
      return;
    }
    await this.openSubSocket();
  }

  private openSubSocket(): Promise<void> {
    return new Promise((resolve) => {
      const u = new URL(config.valkeyUrl);
      const s = net.createConnection({ host: u.hostname, port: Number(u.port) || 6379 });
      s.setNoDelay(true);
      this.subSock = s;
      const username = decodeURIComponent(u.username || '');
      const password = decodeURIComponent(u.password || '');
      s.on('connect', () => {
        if (password) {
          s.write(username ? this.pack(['AUTH', username, password]) : this.pack(['AUTH', password]));
        }
        for (const channel of this.subs.keys()) s.write(this.pack(['SUBSCRIBE', channel]));
        resolve();
      });
      s.on('data', (chunk) => {
        this.subBuf = this.subBuf.length ? Buffer.concat([this.subBuf, chunk]) : chunk;
        this.drainSub();
      });
      s.on('error', () => {});
      s.on('close', () => {
        if (this.subSock === s) {
          this.subSock = null;
          this.subBuf = Buffer.alloc(0);
          if (this.subs.size) setTimeout(() => { void this.openSubSocket(); }, 1000);
        }
      });
      s.on('error', () => {});
    });
  }

  private drainSub(): void {
    const buf = this.subBuf;
    let idx = 0;
    // Consume simple replies (AUTH +OK and similar) first, then pushed arrays.
    while (idx < buf.length && buf[idx] !== 0x2a) {
      const le = buf.indexOf('\r\n', idx);
      if (le < 0) return;
      idx = le + 2;
    }
    while (idx < buf.length && buf[idx] === 0x2a) {
      const le = buf.indexOf('\r\n', idx);
      if (le < 0) break;
      const count = parseInt(buf.toString('utf8', idx + 1, le), 10);
      let pos = le + 2;
      const items: string[] = [];
      let complete = true;
      for (let i = 0; i < count; i++) {
        if (pos >= buf.length) { complete = false; break; }
        const t = buf[pos];
        const e = buf.indexOf('\r\n', pos);
        if (e < 0) { complete = false; break; }
        if (t === 0x24) {
          const len = parseInt(buf.toString('utf8', pos + 1, e), 10);
          if (buf.length < e + 2 + len + 2) { complete = false; break; }
          items.push(buf.toString('utf8', e + 2, e + 2 + len));
          pos = e + 2 + len + 2;
        } else if (t === 0x3a || t === 0x2b || t === 0x2d) {
          items.push(buf.toString('utf8', pos + 1, e));
          pos = e + 2;
        } else { complete = false; break; }
      }
      if (!complete) break;
      idx = pos;
      if (items[0] === 'message' && items.length >= 3) this.subs.get(items[1])?.(items[2]);
    }
    this.subBuf = buf.subarray(idx);
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.call(['HSET', key, field, value]);
  }

  async hdel(key: string, field: string): Promise<void> {
    await this.call(['HDEL', key, field]);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const items = (await this.call(['HGETALL', key])) as string[];
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < items.length; i += 2) out[items[i]] = items[i + 1];
    return out;
  }

  async set(key: string, value: string): Promise<void> {
    await this.call(['SET', key, value]);
  }

  async get(key: string): Promise<string | null> {
    const r = await this.call(['GET', key]);
    return r === undefined ? null : String(r);
  }

  async del(...keys: string[]): Promise<void> {
    await this.call(['DEL', ...keys]);
  }

  async exists(key: string): Promise<boolean> {
    return String(await this.call(['EXISTS', key])) === '1';
  }
}

export const s3 = new S3();
export const valkey = new Valkey();

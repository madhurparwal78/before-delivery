// MinIO byte store for blob payloads and square snapshots, using the S3 REST
// API with AWS SigV4 signing (no SDK dependency). All storage access happens
// here, and reachability is rechecked on every request and on a timer.

import { createHash, createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface PutResult {
  ok: boolean;
  etag?: string;
  error?: string;
}

export interface StorageStatus {
  reachable: boolean;
  lastError: string | null;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** Signs a request with AWS SigV4. Returns the Authorization header value. */
export function signRequest(
  cfg: StorageConfig,
  method: string,
  path: string,
  headers: Record<string, string>,
  payload: Buffer,
  now: Date,
): string {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);
  const lowered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    lowered[key.toLowerCase()] = value;
  }
  const signedHeaders = Object.keys(lowered).sort();
  const canonicalHeaders = signedHeaders.map((h) => `${h}:${lowered[h]!.trim()}\n`).join("");
  const canonicalRequest = [
    method,
    path,
    "",
    canonicalHeaders,
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`;
}

export interface StorageResponse {
  status: number;
  body: Buffer;
}

function performRequest(
  cfg: StorageConfig,
  method: string,
  objectKey: string | null,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<StorageResponse> {
  const url = new URL(cfg.endpoint);
  const host = url.hostname;
  const port = url.port || (url.protocol === "https:" ? 443 : 80);
  const isHttps = url.protocol === "https:";
  const base = cfg.forcePathStyle ? `/${cfg.bucket}` : "";
  const path = objectKey === null ? `${base}/` : `${base}/${objectKey}`;
  const headers: Record<string, string> = {
    Host: port === 80 || port === 443 ? host : `${host}:${port}`,
    "x-amz-content-sha256": sha256Hex(payload),
    "x-amz-date": new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""),
    "Content-Length": String(payload.length),
    ...extraHeaders,
  };
  const authorization = signRequest(cfg, method, path, headers, payload, new Date());
  headers.Authorization = authorization;
  return new Promise((resolve, reject) => {
    const doRequest = isHttps ? httpsRequest : httpRequest;
    const req = doRequest(
      {
        host,
        port: Number(port),
        method,
        path,
        headers,
        timeout: 4000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("storage timeout"));
    });
    req.on("error", reject);
    if (payload.length > 0) req.write(payload);
    req.end();
  });
}

export class Storage {
  private cfg: StorageConfig;
  reachable = true;
  lastError: string | null = null;
  private pendingWrites: { key: string; body: Buffer }[] = [];

  constructor(cfg: StorageConfig) {
    this.cfg = cfg;
  }

  private mark(error: string | null) {
    if (error === null) {
      this.reachable = true;
      this.lastError = null;
    } else {
      this.reachable = false;
      this.lastError = error;
    }
  }

  /** Pings the bucket; updates reachability. */
  async check(): Promise<boolean> {
    try {
      const res = await performRequest(this.cfg, "GET", null, Buffer.alloc(0));
      const ok = res.status === 200;
      this.mark(ok ? null : `bucket status ${res.status}`);
      return ok;
    } catch (error) {
      this.mark(error instanceof Error ? error.message : "storage unreachable");
      return false;
    }
  }

  /** Reads an object; resolves null when absent. */
  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await performRequest(this.cfg, "GET", key, Buffer.alloc(0));
      if (res.status === 200) {
        this.mark(null);
        return res.body;
      }
      if (res.status === 404) {
        this.mark(null);
        return null;
      }
      this.mark(`get status ${res.status}`);
      return null;
    } catch (error) {
      this.mark(error instanceof Error ? error.message : "storage unreachable");
      return null;
    }
  }

  /** Writes an object and confirms the exact byte count came back on read. */
  async putConfirmed(key: string, body: Buffer): Promise<PutResult> {
    try {
      const res = await performRequest(this.cfg, "PUT", key, body);
      if (res.status !== 200) {
        this.mark(`put status ${res.status}`);
        return { ok: false, error: `put status ${res.status}` };
      }
      const readBack = await performRequest(this.cfg, "GET", key, Buffer.alloc(0));
      if (readBack.status !== 200 || !readBack.body.equals(body)) {
        this.mark(`verify status ${readBack.status}`);
        return { ok: false, error: "verification failed" };
      }
      this.mark(null);
      return { ok: true, etag: res.body.toString() || undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : "storage unreachable";
      this.mark(message);
      return { ok: false, error: message };
    }
  }

  /** Puts an object, deferring it when storage is down; retried on a timer. */
  async putDeferred(key: string, body: Buffer): Promise<void> {
    const result = await this.putConfirmed(key, body);
    if (!result.ok) {
      this.pendingWrites.push({ key, body });
    }
  }

  /** Retries deferred writes; called every few seconds. */
  async flushPending(): Promise<void> {
    const pending = this.pendingWrites;
    this.pendingWrites = [];
    for (const write of pending) {
      const result = await this.putConfirmed(write.key, write.body);
      if (!result.ok) this.pendingWrites.push(write);
    }
  }

  /** Empties the bucket by listing and deleting every object. */
  async emptyBucket(): Promise<void> {
    try {
      const list = await this.listKeys();
      for (const key of list) {
        await performRequest(this.cfg, "DELETE", key, Buffer.alloc(0));
      }
      this.pendingWrites = [];
      this.mark(null);
    } catch (error) {
      this.mark(error instanceof Error ? error.message : "storage unreachable");
    }
  }

  async listKeys(): Promise<string[]> {
    const res = await performRequest(this.cfg, "GET", null, Buffer.alloc(0));
    if (res.status !== 200) return [];
    return this.parseListXml(res.body.toString("utf8"));
  }

  private parseListXml(xml: string): string[] {
    const keys: string[] = [];
    const matches = xml.matchAll(/<Key>([^<]+)<\/Key>/g);
    for (const match of matches) {
      if (match[1]!) keys.push(decodeXml(match[1]!));
    }
    return keys;
  }

  get isReachable(): boolean {
    return this.reachable;
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

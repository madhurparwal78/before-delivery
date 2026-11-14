import { createHash, createHmac } from "node:crypto";
import type { Config } from "./config.js";

export class FileStoreUnavailable extends Error {}

const REQUEST_TIMEOUT_MS = 5000;

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export class FileStore {
  private readonly config: Config["s3"];

  constructor(config: Config["s3"]) {
    this.config = config;
  }

  private url(key: string): URL {
    const endpoint = new URL(this.config.endpoint);
    const path = key === "" ? "" : `/${key.split("/").map(encodeSegment).join("/")}`;
    if (this.config.forcePathStyle) return new URL(`${endpoint.origin}/${encodeSegment(this.config.bucket)}${path}`);
    return new URL(`${endpoint.protocol}//${this.config.bucket}.${endpoint.host}${path || "/"}`);
  }

  private async send(method: string, key: string, body?: Uint8Array, contentType?: string): Promise<Response> {
    const url = this.url(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = amzDate.slice(0, 8);
    const payloadHash = body === undefined ? sha256Hex("") : sha256Hex(body);
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType !== undefined) headers["content-type"] = contentType;
    const signedHeaders = Object.keys(headers).sort();
    const canonicalRequest = [
      method,
      url.pathname,
      "",
      signedHeaders.map((h) => `${h}:${headers[h]}\n`).join(""),
      signedHeaders.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${day}/${this.config.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.config.secretAccessKey}`, day), this.config.region), "s3"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    const { host: _host, ...sent } = headers;
    try {
      return await fetch(url, {
        method,
        headers: {
          ...sent,
          authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`,
        },
        body: body === undefined ? undefined : Uint8Array.from(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new FileStoreUnavailable();
    }
  }

  async ensureBucket(): Promise<void> {
    const head = await this.send("HEAD", "");
    if (head.ok) return;
    if (head.status !== 404) throw new FileStoreUnavailable();
    const created = await this.send("PUT", "");
    await created.arrayBuffer();
    if (!created.ok && created.status !== 409) throw new FileStoreUnavailable();
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.send("HEAD", key);
    if (res.status === 404) return false;
    if (!res.ok) throw new FileStoreUnavailable();
    return true;
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const res = await this.send("PUT", key, body, contentType);
    await res.arrayBuffer();
    if (!res.ok) throw new FileStoreUnavailable();
  }

  /** Returns null when the object does not exist. */
  async get(key: string): Promise<Response | null> {
    const res = await this.send("GET", key);
    if (res.status === 404) {
      await res.arrayBuffer();
      return null;
    }
    if (!res.ok || res.body === null) {
      await res.arrayBuffer();
      throw new FileStoreUnavailable();
    }
    return res;
  }
}

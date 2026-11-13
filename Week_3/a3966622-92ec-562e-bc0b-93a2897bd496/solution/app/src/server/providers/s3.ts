// The evidence store over the S3 API with AWS Signature Version 4: put, get, bucket check and create.
import { createHash, createHmac } from "node:crypto";
import type { Config } from "../config.js";
import { ProviderError } from "./providerError.js";

const TIMEOUT_MS = 15_000;

const sha256Hex = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, text: string): Buffer => createHmac("sha256", key).update(text).digest();
const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");

export class ObjectStore {
  constructor(private readonly config: Config["s3"]) {}

  private target(key: string): URL {
    const base = new URL(this.config.endpoint);
    if (this.config.forcePathStyle) {
      base.pathname = `/${this.config.bucket}${key ? `/${key}` : ""}`;
    } else {
      base.hostname = `${this.config.bucket}.${base.hostname}`;
      base.pathname = `/${key}`;
    }
    return base;
  }

  private signed(method: string, url: URL, body: Buffer, extra: Record<string, string>): Record<string, string> {
    const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = now.slice(0, 8);
    const payloadHash = sha256Hex(body);
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": now,
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.toLowerCase(), v])),
    };
    const names = Object.keys(headers).sort();
    const canonical = [
      method,
      encodePath(url.pathname),
      "",
      names.map((n) => `${n}:${headers[n]}\n`).join(""),
      names.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${day}/${this.config.region}/s3/aws4_request`;
    const toSign = `AWS4-HMAC-SHA256\n${now}\n${scope}\n${sha256Hex(canonical)}`;
    const signingKey = [day, this.config.region, "s3", "aws4_request"].reduce<Buffer | string>(
      (key, part) => hmac(key, part),
      `AWS4${this.config.secretAccessKey}`,
    );
    const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
    const { host: _host, ...sent } = headers;
    return {
      ...sent,
      Authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    };
  }

  private async request(method: string, key: string, body: Buffer = Buffer.alloc(0), extra: Record<string, string> = {}): Promise<Response> {
    if (!this.config.endpoint || !this.config.bucket) throw new ProviderError("S3_ENDPOINT or S3_BUCKET is not set");
    const url = this.target(key);
    try {
      return await fetch(url, {
        method,
        headers: this.signed(method, url, body, extra),
        body: body.length ? new Uint8Array(body) : null,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ProviderError(`S3 ${method} ${key}: ${String(error)}`);
    }
  }

  /** True when the bucket exists, creating it (private) if the store answers that it is absent. */
  async ensureBucket(): Promise<boolean> {
    try {
      const head = await this.request("HEAD", "");
      if (head.ok) return true;
      if (head.status !== 404) return false;
      const made = await this.request("PUT", "");
      return made.ok || made.status === 409;
    } catch {
      return false;
    }
  }

  /** Stores bytes unmodified; resolves only once the store confirms the write and its MD5 matches. */
  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const md5 = createHash("md5").update(data).digest();
    const response = await this.request("PUT", key, data, {
      "content-type": contentType,
      "content-md5": md5.toString("base64"),
    });
    const etag = (response.headers.get("etag") ?? "").replaceAll('"', "");
    if (!response.ok || etag !== md5.toString("hex")) throw new ProviderError(`S3 put ${key} answered ${response.status}`);
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.request("GET", key);
    if (!response.ok) throw new ProviderError(`S3 get ${key} answered ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

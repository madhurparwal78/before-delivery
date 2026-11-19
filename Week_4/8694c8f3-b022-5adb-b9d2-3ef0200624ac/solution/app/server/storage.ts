import { createHash, createHmac } from "node:crypto";
import type { StorageConfig } from "./config.ts";

export class StorageDown extends Error {}

const sha256Hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Uint8Array | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface StoredObject {
  size: number;
  etag: string;
}

export class Storage {
  private readonly config: StorageConfig;
  private readonly onOutcome: (reachable: boolean) => void;

  constructor(config: StorageConfig, onOutcome: (reachable: boolean) => void) {
    this.config = config;
    this.onOutcome = onOutcome;
  }

  private async send(
    method: string,
    key: string,
    options: { body?: Buffer; contentType?: string; query?: string; timeoutMs?: number } = {},
  ): Promise<Response> {
    const endpoint = new URL(this.config.endpoint);
    const segments = key === "" ? [] : key.split("/").map(encodeSegment);
    const host = this.config.forcePathStyle ? endpoint.host : `${this.config.bucket}.${endpoint.host}`;
    const path = this.config.forcePathStyle
      ? `/${[encodeSegment(this.config.bucket), ...segments].join("/")}`
      : `/${segments.join("/")}`;
    const payload = options.body ?? Buffer.alloc(0);
    const payloadHash = sha256Hex(payload);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = amzDate.slice(0, 8);
    const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonical = [
      method, path, options.query ?? "",
      Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join(""),
      signedHeaders, payloadHash,
    ].join("\n");
    const scope = `${day}/${this.config.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
    let signingKey = hmac(`AWS4${this.config.secretAccessKey}`, day);
    for (const part of [this.config.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
    const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
    const requestHeaders: Record<string, string> = {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
    if (options.contentType) requestHeaders["content-type"] = options.contentType;
    const url = `${endpoint.protocol}//${host}${path}${options.query ? `?${options.query}` : ""}`;
    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: options.body ? new Uint8Array(options.body) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      });
      if (response.status >= 500 || response.status === 403) {
        await response.arrayBuffer();
        throw new StorageDown(`storage answered ${response.status}`);
      }
      this.onOutcome(true);
      return response;
    } catch (error) {
      this.onOutcome(false);
      throw error instanceof StorageDown ? error : new StorageDown("storage is unreachable");
    }
  }

  async probe(): Promise<boolean> {
    try {
      const response = await this.send("GET", "", { query: "list-type=2&max-keys=1", timeoutMs: 2000 });
      await response.arrayBuffer();
      return response.ok;
    } catch {
      return false;
    }
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const response = await this.send("PUT", key, { body: bytes, contentType });
    await response.arrayBuffer();
    if (!response.ok) throw new StorageDown(`storage refused the write (${response.status})`);
  }

  async head(key: string): Promise<StoredObject | null> {
    const response = await this.send("HEAD", key, { timeoutMs: 5000 });
    if (response.status === 404) return null;
    if (!response.ok) throw new StorageDown(`storage refused the read (${response.status})`);
    return { size: Number(response.headers.get("content-length")), etag: (response.headers.get("etag") ?? "").replace(/"/g, "") };
  }

  async get(key: string): Promise<Buffer | null> {
    const response = await this.send("GET", key);
    if (response.status === 404) return null;
    if (!response.ok) throw new StorageDown(`storage refused the read (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    const response = await this.send("DELETE", key, { timeoutMs: 8000 });
    await response.arrayBuffer();
  }

  /** Writes the bytes, then confirms through the object's metadata that size and checksum match. */
  async putConfirmed(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.put(key, bytes, contentType);
    const stored = await this.head(key);
    const checksum = createHash("md5").update(bytes).digest("hex");
    if (!stored || stored.size !== bytes.length || stored.etag !== checksum) {
      await this.remove(key).catch(() => undefined);
      throw new StorageDown("storage did not confirm the write");
    }
  }
}

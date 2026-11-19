import { createHash, createHmac } from "node:crypto";
import { type StorageSettings } from "./config.js";

/** A minimal S3 client: AWS Signature Version 4 over `fetch`. Only server code ever talks to the object store. */

const REQUEST_TIMEOUT_MS = 3000;
const EMPTY_PAYLOAD_HASH = createHash("sha256").update("").digest("hex");

export class StorageUnavailableError extends Error {
  constructor(reason: string) {
    super(`The object store is unavailable: ${reason}`);
    this.name = "StorageUnavailableError";
  }
}

type StoreAnswer = "present" | "missing";

export interface StoredObject {
  readonly bytes: Buffer;
  readonly contentType: string;
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Uint8Array, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function amzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export class ObjectStore {
  constructor(private readonly settings: StorageSettings) {}

  private location(key: string | undefined): URL {
    const endpoint = new URL(this.settings.endpoint);
    const bucket = this.settings.bucket;
    if (this.settings.forcePathStyle) {
      endpoint.pathname = key === undefined ? `/${bucket}` : `/${bucket}/${key}`;
    } else {
      endpoint.hostname = `${bucket}.${endpoint.hostname}`;
      endpoint.pathname = key === undefined ? "/" : `/${key}`;
    }
    return endpoint;
  }

  private sign(method: string, url: URL, payloadHash: string, date: string): string {
    const day = date.slice(0, 8);
    const scope = `${day}/${this.settings.region}/s3/aws4_request`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${date}\n`;
    const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const toSign = ["AWS4-HMAC-SHA256", date, scope, sha256Hex(canonicalRequest)].join("\n");
    const signingKey = [day, this.settings.region, "s3", "aws4_request"].reduce<Buffer | string>(
      (key, part) => hmac(key, part),
      `AWS4${this.settings.secretAccessKey}`,
    );
    const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
    return `AWS4-HMAC-SHA256 Credential=${this.settings.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }

  private async send(method: string, key: string | undefined, body?: Uint8Array, contentType?: string): Promise<Response> {
    const url = this.location(key);
    const payloadHash = body === undefined ? EMPTY_PAYLOAD_HASH : sha256Hex(body);
    const date = amzDate(new Date());
    const headers: Record<string, string> = {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": date,
      authorization: this.sign(method, url, payloadHash, date),
    };
    if (contentType !== undefined) headers["content-type"] = contentType;
    try {
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
      if (body !== undefined) init.body = Buffer.from(body);
      const response = await fetch(url, init);
      if (response.status >= 500) throw new StorageUnavailableError(`status ${response.status}`);
      return response;
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw error;
      throw new StorageUnavailableError(error instanceof Error ? error.message : "request failed");
    }
  }

  private static async drain(response: Response): Promise<void> {
    await response.arrayBuffer();
  }

  async headBucket(): Promise<StoreAnswer> {
    const response = await this.send("HEAD", undefined);
    await ObjectStore.drain(response);
    if (response.status === 404) return "missing";
    if (!response.ok) throw new StorageUnavailableError(`bucket check answered ${response.status}`);
    return "present";
  }

  async createBucket(): Promise<void> {
    const response = await this.send("PUT", undefined, new Uint8Array());
    await ObjectStore.drain(response);
    if (!response.ok && response.status !== 409) throw new StorageUnavailableError(`bucket creation answered ${response.status}`);
  }

  async headObject(key: string): Promise<StoreAnswer> {
    const response = await this.send("HEAD", key);
    await ObjectStore.drain(response);
    if (response.status === 404) return "missing";
    if (!response.ok) throw new StorageUnavailableError(`object check answered ${response.status}`);
    return "present";
  }

  async getObject(key: string): Promise<StoredObject | undefined> {
    const response = await this.send("GET", key);
    if (response.status === 404) {
      await ObjectStore.drain(response);
      return undefined;
    }
    if (!response.ok) throw new StorageUnavailableError(`object read answered ${response.status}`);
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const response = await this.send("PUT", key, bytes, contentType);
    await ObjectStore.drain(response);
    if (!response.ok) throw new StorageUnavailableError(`object write answered ${response.status}`);
  }

  async deleteObject(key: string): Promise<void> {
    const response = await this.send("DELETE", key);
    await ObjectStore.drain(response);
    if (!response.ok && response.status !== 404) throw new StorageUnavailableError(`object removal answered ${response.status}`);
  }
}

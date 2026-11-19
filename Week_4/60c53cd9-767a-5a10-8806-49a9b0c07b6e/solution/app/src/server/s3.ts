/** A minimal S3 client (SigV4, path style, single-part uploads) for the MinIO bucket. */
import { createHash, createHmac } from "node:crypto";
import { wallClock } from "./clock.js";
import type { Config } from "./config.js";

export class StorageUnavailable extends Error {}

interface StoredObject {
  readonly body: Buffer;
  readonly etag: string;
}

interface ObjectHead {
  readonly size: number;
  readonly etag: string;
}

const sha256Hex = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeKey = (key: string): string => key.split("/").map((part) => encodeURIComponent(part)).join("/");

export class ObjectStore {
  constructor(private readonly config: Config["s3"]) {}

  private async send(
    method: "GET" | "PUT" | "HEAD",
    key: string,
    body: Buffer = Buffer.alloc(0),
    contentType?: string,
  ): Promise<Response> {
    const endpoint = new URL(this.config.endpoint);
    if (!this.config.forcePathStyle) endpoint.hostname = `${this.config.bucket}.${endpoint.hostname}`;
    const objectPath = key === "" ? "" : `/${encodeKey(key)}`;
    const url = new URL(`${endpoint.origin}${this.config.forcePathStyle ? `/${this.config.bucket}` : ""}${objectPath}`);
    const now = wallClock();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body);
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType) headers["content-type"] = contentType;
    const names = Object.keys(headers).sort();
    const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
    const signedHeaders = names.join(";");
    const canonical = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${day}/${this.config.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
    let signingKey = hmac(`AWS4${this.config.secretAccessKey}`, day);
    for (const part of [this.config.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
    const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
    const { host: _host, ...sendable } = headers;
    try {
      return await fetch(url, {
        method,
        headers: {
          ...sendable,
          authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        },
        body: method === "PUT" ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new StorageUnavailable("storage unreachable");
    }
  }

  private static unwrap(response: Response): void {
    if (response.status >= 500) throw new StorageUnavailable(`storage answered ${response.status}`);
  }

  async ensureBucket(): Promise<void> {
    const head = await this.send("HEAD", "");
    if (head.status === 200) return;
    const created = await this.send("PUT", "");
    ObjectStore.unwrap(created);
    if (created.status >= 400 && created.status !== 409) throw new StorageUnavailable(`bucket create answered ${created.status}`);
  }

  async head(key: string): Promise<ObjectHead | null> {
    const response = await this.send("HEAD", key);
    if (response.status === 404) return null;
    ObjectStore.unwrap(response);
    if (!response.ok) throw new StorageUnavailable(`head answered ${response.status}`);
    return {
      size: Number(response.headers.get("content-length") ?? "0"),
      etag: (response.headers.get("etag") ?? "").replace(/"/g, ""),
    };
  }

  async get(key: string): Promise<StoredObject | null> {
    const response = await this.send("GET", key);
    if (response.status === 404) return null;
    ObjectStore.unwrap(response);
    if (!response.ok) throw new StorageUnavailable(`get answered ${response.status}`);
    return {
      body: Buffer.from(await response.arrayBuffer()),
      etag: (response.headers.get("etag") ?? "").replace(/"/g, ""),
    };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const response = await this.send("PUT", key, body, contentType);
    ObjectStore.unwrap(response);
    if (!response.ok) throw new StorageUnavailable(`put answered ${response.status}`);
  }
}

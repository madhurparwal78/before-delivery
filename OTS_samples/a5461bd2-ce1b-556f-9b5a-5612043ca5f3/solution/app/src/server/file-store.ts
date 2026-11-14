import { createHash, createHmac } from "node:crypto";
import type { Config } from "./config";

/** The private MinIO bucket, reached with signed requests (AWS Signature Version 4). */

export class FileStoreUnavailable extends Error {}

type FileStream = { body: ReadableStream<Uint8Array>; size: number | null };

const REQUEST_TIMEOUT_MS = 8000;

function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

export class FileStore {
  constructor(private readonly settings: Config["s3"]) {}

  private locate(key: string): URL {
    const { endpoint, bucket, forcePathStyle } = this.settings;
    const path = key.split("/").map(encodeURIComponent).join("/");
    const base = new URL(endpoint);
    if (forcePathStyle) return new URL(`${base.origin}/${bucket}/${path}`);
    return new URL(`${base.protocol}//${bucket}.${base.host}/${path}`);
  }

  private async send(method: "GET" | "HEAD" | "PUT", key: string, body?: Uint8Array, type?: string): Promise<Response> {
    const url = this.locate(key);
    const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const day = now.slice(0, 8);
    const payload = sha256(body ?? "");
    const { region, accessKeyId, secretAccessKey } = this.settings;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonical = [method, url.pathname, "", `host:${url.host}\nx-amz-content-sha256:${payload}\nx-amz-date:${now}\n`, signedHeaders, payload].join("\n");
    const scope = `${day}/${region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", now, scope, sha256(canonical)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
    const headers: Record<string, string> = {
      "x-amz-content-sha256": payload,
      "x-amz-date": now,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
    if (type) headers["Content-Type"] = type;
    try {
      return await fetch(url, { method, headers, ...(body ? { body: body as BodyInit } : {}), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new FileStoreUnavailable();
    }
  }

  async exists(key: string): Promise<boolean> {
    const response = await this.send("HEAD", key);
    if (response.status === 404) return false;
    if (!response.ok) throw new FileStoreUnavailable();
    return true;
  }

  async put(key: string, body: Uint8Array, type: string): Promise<void> {
    const response = await this.send("PUT", key, body, type);
    await response.arrayBuffer();
    if (!response.ok) throw new FileStoreUnavailable();
  }

  /** Streams an object; null when the bucket has no such key. */
  async open(key: string): Promise<FileStream | null> {
    const response = await this.send("GET", key);
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok || !response.body) throw new FileStoreUnavailable();
    const length = Number(response.headers.get("content-length"));
    return { body: response.body, size: Number.isFinite(length) && length > 0 ? length : null };
  }
}

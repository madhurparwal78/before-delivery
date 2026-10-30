// Object storage over the S3 API, signed with AWS Signature Version 4. Only the configured bucket is used.
import { createHash, createHmac } from "node:crypto";
import { type Config } from "../config.js";

export class StorageUnavailable extends Error {}

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function encodeKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

export class Storage {
  constructor(private readonly cfg: Config["s3"]) {}

  private target(key: string): { url: URL; path: string } {
    const endpoint = new URL(this.cfg.endpoint);
    const objectPath = key === "" ? "" : `/${encodeKey(key)}`;
    if (this.cfg.forcePathStyle) {
      const path = `${endpoint.pathname.replace(/\/$/, "")}/${this.cfg.bucket}${objectPath}`;
      return { url: new URL(path, endpoint), path };
    }
    const url = new URL(endpoint.toString());
    url.hostname = `${this.cfg.bucket}.${endpoint.hostname}`;
    url.pathname = objectPath || "/";
    return { url, path: url.pathname };
  }

  private async request(method: string, key: string, body?: Buffer, contentType?: string): Promise<Response> {
    const { url, path } = this.target(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = amzDate.slice(0, 8);
    const payloadHash = sha256(body ?? "");
    const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
    if (contentType) headers["content-type"] = contentType;
    const names = Object.keys(headers).sort();
    const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
    const scope = `${day}/${this.cfg.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
    let signingKey = hmac(`AWS4${this.cfg.secretAccessKey}`, day);
    for (const part of [this.cfg.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
    const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
    const { host: _host, ...sent } = headers;
    try {
      return await fetch(url, {
        method,
        headers: { ...sent, authorization },
        body: body ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new StorageUnavailable();
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const r = await this.request("PUT", key, body, contentType);
    await r.arrayBuffer();
    if (!r.ok) throw new StorageUnavailable();
  }

  async get(key: string): Promise<Buffer> {
    const r = await this.request("GET", key);
    const data = Buffer.from(await r.arrayBuffer());
    if (!r.ok) throw new StorageUnavailable();
    return data;
  }

  async remove(key: string): Promise<void> {
    const r = await this.request("DELETE", key);
    await r.arrayBuffer();
    if (!r.ok && r.status !== 404) throw new StorageUnavailable();
  }

  /** True when the bucket answers. */
  async reachable(): Promise<boolean> {
    try {
      const r = await this.request("HEAD", "");
      await r.arrayBuffer();
      return r.ok;
    } catch {
      return false;
    }
  }
}

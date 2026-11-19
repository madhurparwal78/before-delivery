import { createHmac, createHash } from "node:crypto";
import { config } from "../config.js";

/** Minimal S3 client with AWS SigV4 for MinIO (path style). */
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const sha256hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

export type StoredObject = { key: string; bytes: Buffer; contentType?: string };

export class S3 {
  private readonly endpoint: URL;
  constructor() {
    this.endpoint = new URL(config.s3.endpoint);
  }
  private host(): string {
    return `${this.endpoint.hostname}${this.endpoint.port ? `:${this.endpoint.port}` : ""}`;
  }
  private path(key: string): string {
    const bucket = encodeURIComponent(config.s3.bucket);
    return `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  private async request(method: string, key: string, body?: Buffer, contentType?: string): Promise<Response> {
    const url = new URL(this.endpoint);
    url.pathname = this.path(key);
    const now = new Date();
    const amzDate = `${now.toISOString().replace(/[:-]/g, "").slice(0, 15)}Z`;
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = body ? sha256hex(body) : sha256hex("");
    const signedHeaders: Record<string, string> = {
      host: this.host(),
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType) signedHeaders["content-type"] = contentType;
    const headerNames = Object.keys(signedHeaders).sort();
    const canonicalHeaders = headerNames.map((h) => `${h}:${signedHeaders[h]}\n`).join("");
    const signedHeaderList = headerNames.join(";");
    const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaderList, payloadHash].join("\n");
    const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
    const kDate = hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, config.s3.region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
    const auth = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`;
    const headers: Record<string, string> = { ...signedHeaders, Authorization: auth };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      return await fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
  async ensureBucket(): Promise<void> {
    const exists = await this.request("HEAD", "").catch(() => null);
    if (exists && exists.ok) return;
    await this.request("PUT", "").catch(() => undefined);
  }
  async put(key: string, bytes: Buffer, contentType = "application/octet-stream"): Promise<boolean> {
    try {
      const res = await this.request("PUT", key, bytes, contentType);
      return res.ok;
    } catch {
      return false;
    }
  }
  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.request("GET", key);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
  async del(key: string): Promise<boolean> {
    try {
      const res = await this.request("DELETE", key);
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  }
  async list(prefix: string): Promise<string[]> {
    try {
      const url = new URL(this.endpoint);
      url.pathname = `/${config.s3.bucket}`;
      url.search = `?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`;
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) return [];
      const xml = await res.text();
      const keys: string[] = [];
      const re = /<Key>([^<]+)<\/Key>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml))) keys.push(decodeURIComponent(m[1]!));
      return keys;
    } catch {
      return [];
    }
  }
}

export const s3 = new S3();

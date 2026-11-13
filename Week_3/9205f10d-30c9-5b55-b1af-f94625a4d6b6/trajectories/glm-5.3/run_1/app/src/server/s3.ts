import { createHash, createHmac } from "node:crypto";
import type { Config } from "./config.js";

type SignedMethod = "GET" | "PUT" | "HEAD" | "DELETE";

/**
 * Minimal S3 REST client with AWS SigV4. Only the operations the app needs:
 * object PUT/GET and signed links for private reads.
 */
export class S3Store {
  private readonly cfg: Config["s3"];

  constructor(cfg: Config["s3"]) {
    this.cfg = cfg;
  }

  private endpointParts(): URL {
    return new URL(this.cfg.endpoint);
  }

  private urlFor(key: string): URL {
    const base = this.endpointParts();
    const path = this.cfg.forcePathStyle
      ? `/${this.cfg.bucket}/${key}`
      : key;
    const host = this.cfg.forcePathStyle
      ? base.host
      : `${this.cfg.bucket}.${base.host}`;
    return new URL(`${base.protocol}//${host}${path}`);
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const url = this.urlFor(key);
    await this.request("PUT", url, body, { "content-type": contentType });
  }

  async headBucket(): Promise<boolean> {
    const base = this.endpointParts();
    const host = this.cfg.forcePathStyle
      ? base.host
      : `${this.cfg.bucket}.${base.host}`;
    const url = new URL(`${base.protocol}//${host}/${this.cfg.forcePathStyle ? this.cfg.bucket : ""}`);
    try {
      await this.request("HEAD", url, Buffer.alloc(0), {});
      return true;
    } catch {
      return false;
    }
  }

  async ensureBucket(): Promise<void> {
    const base = this.endpointParts();
    const host = this.cfg.forcePathStyle ? base.host : `${this.cfg.bucket}.${base.host}`;
    const path = this.cfg.forcePathStyle ? `/${this.cfg.bucket}` : "/";
    const url = new URL(`${base.protocol}//${host}${path}`);
    const res = await this.request("PUT", url, Buffer.alloc(0), {});
    if (res.status >= 300) throw new Error(`bucket create failed: ${res.status}`);
  }

  async getObject(key: string): Promise<Buffer> {
    const url = this.urlFor(key);
    const res = await this.request("GET", url, Buffer.alloc(0), {});
    return res.body;
  }

  signedUrl(key: string, expiresSeconds: number): string {
    const url = this.urlFor(key);
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const params = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.cfg.accessKeyId}/${credentialScope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresSeconds),
      "X-Amz-SignedHeaders": "host",
    });
    const canonicalQuery = [...params.entries()]
      .map(([k, v]) => `${awsUriEncode(k)}=${awsUriEncode(v)}`)
      .sort()
      .join("&");
    const canonicalHeaders = `host:${url.host}\n`;
    const payloadHash = "UNSIGNED-PAYLOAD";
    const canonicalRequest = [
      "GET",
      url.pathname,
      canonicalQuery,
      canonicalHeaders,
      "host",
      payloadHash,
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256hex(canonicalRequest),
    ].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp), this.cfg.region), "s3"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    return `${url.toString()}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  private async request(
    method: SignedMethod,
    url: URL,
    body: Buffer,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: Buffer }> {
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256hex(body);
    const contentType = headers["content-type"] ?? "";
    const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const credentialScope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256hex(canonicalRequest)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp), this.cfg.region), "s3"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const res = await fetch(url, {
      method,
      headers: {
        host: url.host,
        "x-amz-date": amzDate,
        "x-amz-content-sha256": payloadHash,
        ...(contentType ? { "content-type": contentType } : {}),
        ...(body.length ? { "content-length": String(body.length) } : {}),
        authorization,
      },
      body: body.length ? new Uint8Array(body) : null,
      signal: AbortSignal.timeout(10_000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.status >= 300) {
      throw new Error(`S3 ${method} ${url.pathname} -> ${res.status}: ${buf.subarray(0, 200).toString("utf8")}`);
    }
    return { status: res.status, body: buf };
  }
}

function toAmzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function sha256hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function awsUriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

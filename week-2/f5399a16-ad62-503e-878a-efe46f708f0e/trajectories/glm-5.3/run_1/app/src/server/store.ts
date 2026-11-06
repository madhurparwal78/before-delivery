// MinIO (S3) client over the raw REST API: the AWS SDK is a shipped
// dependency, but the subset the app needs (create bucket, put, get, delete,
// exists) is small enough to serve through fetch, byte for byte.

import type { Config } from "./config";
import { createHash, createHmac } from "node:crypto";

export type StoreResult = { ok: true } | { ok: false };

export class Store {
  constructor(private readonly config: Config) {}

  private endpoint(): URL {
    return new URL(this.config.s3.endpoint);
  }

  // Signed request to the object store; the credentials come from the
  // environment and never reach the browser.
  private async signed(
    method: string,
    key: string,
    body: Buffer | null,
    contentType: string | null,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const url = this.endpoint();
    const path = `/${this.config.s3.bucket}/${key}`
      .split("/")
      .map((part, i) => (i === 0 ? part : encodeURIComponent(part)))
      .join("/");
    const target = `${url.protocol}//${url.host}${path}`;
    const now = new Date();
    const amzDate = `${now.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, "")}`;
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256").update(body ?? Buffer.alloc(0)).digest("hex");
    const host = url.host;
    const headers: Record<string, string> = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...extraHeaders,
    };
    if (contentType !== null) headers["content-type"] = contentType;
    const signedHeadersList = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((h) => `${h}:${headers[h]}\n`)
      .join("");
    const canonicalRequest = [method, new URL(target).pathname, "", canonicalHeaders, signedHeadersList, payloadHash].join("\n");
    const scope = `${dateStamp}/${this.config.s3.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
    const kDate = createHmac("sha256", `AWS4${this.config.s3.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac("sha256", kDate).update(this.config.s3.region).digest();
    const kService = createHmac("sha256", kRegion).update("s3").digest();
    const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
    const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;
    return await fetch(target, {
      method,
      headers: { ...headers, authorization },
      body: body ?? undefined,
    });
  }

  // Makes the bucket when it is missing, so several copies can start together.
  async ensureBucket(): Promise<StoreResult> {
    try {
      const url = this.endpoint();
      const res = await fetch(`${url.protocol}//${url.host}/${this.config.s3.bucket}`, { method: "HEAD" });
      if (res.status === 200 || res.status === 403) return { ok: true };
      if (res.status === 404) {
        const created = await fetch(`${url.protocol}//${url.host}/${this.config.s3.bucket}`, { method: "PUT" });
        return created.status < 300 ? { ok: true } : { ok: false };
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoreResult> {
    try {
      const res = await this.signed("PUT", key, data, contentType);
      return res.ok ? { ok: true } : { ok: false };
    } catch {
      return { ok: false };
    }
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.signed("GET", key, null, null);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<StoreResult> {
    try {
      const res = await this.signed("DELETE", key, null, null);
      return res.status === 204 || res.ok ? { ok: true } : { ok: false };
    } catch {
      return { ok: false };
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const res = await this.signed("HEAD", key, null, null);
      return res.status === 200;
    } catch {
      return false;
    }
  }
}

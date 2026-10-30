/**
 * Private-object storage on MinIO via the S3 REST API. AWS Signature V4 is computed with node:crypto;
 * no SDK. Objects only reach users through the server's routes.
 */

import { createHash, createHmac } from "node:crypto";
import { ProviderError } from "../http/errors.js";

export class StorageUnavailableError extends ProviderError {
  constructor(cause: Error | string) {
    super("storage", cause);
  }
}

const TIMEOUT_MS = 10_000;

export class Storage {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;

  constructor(
    endpoint: string,
    region: string,
    bucket: string,
    accessKeyId: string,
    secretAccessKey: string
  ) {
    this.endpoint = endpoint;
    this.region = region;
    this.bucket = bucket;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
  }

  private url(path: string): URL {
    return new URL(this.endpoint + path);
  }

  private sign(
    method: string,
    url: URL,
    payload: Buffer | null,
    contentType?: string
  ): { headers: Record<string, string>; signedUrl: URL } {
    const host = url.host;
    const canonicalUri = url.pathname;
    const canonicalQuery = Array.from(url.searchParams.entries())
      .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const payloadHash = payload === null ? "UNSIGNED-PAYLOAD" : sha256Hex(payload);
    const amzDate = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, ""); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8);
    const headers: Record<string, string> = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    };
    if (contentType !== undefined) headers["content-type"] = contentType;
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join("");
    const signedHeaders = signedHeaderNames.join(";");
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join("\n");
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256Hex(Buffer.from(canonicalRequest, "utf8"))
    ].join("\n");
    const kDate = hmacSha256(Buffer.from(`AWS4${this.secretAccessKey}`, "utf8"), dateStamp);
    const kRegion = hmacSha256(kDate, this.region);
    const kService = hmacSha256(kRegion, "s3");
    const kSigning = hmacSha256(kService, "aws4_request");
    const signature = hmacSha256(kSigning, stringToSign).toString("hex");
    headers["authorization"] =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { headers, signedUrl: url };
  }

  private async request(
    method: string,
    path: string,
    body: Buffer | null,
    contentType?: string,
    query?: Record<string, string>
  ): Promise<{ status: number; body: Buffer }> {
    const url = this.url(path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const { headers } = this.sign(method, url, body, contentType);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, {
        method,
        headers,
        body: body === null ? undefined : new Uint8Array(body),
        signal: controller.signal
      });
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, body: buf };
    } catch (e) {
      throw new StorageUnavailableError(
        `Storage unreachable on ${method} ${path}: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async ensureBucket(): Promise<void> {
    const res = await this.request("GET", `/${this.bucket}?location`, null);
    if (res.status === 200) return;
    if (res.status === 404) {
      const created = await this.request("PUT", `/${this.bucket}`, Buffer.alloc(0));
      if (created.status !== 200) {
        throw new StorageUnavailableError(
          `Bucket creation failed: ${created.status} ${created.body.toString("utf8").slice(0, 200)}`
        );
      }
      return;
    }
    throw new StorageUnavailableError(
      `Bucket check failed: ${res.status} ${res.body.toString("utf8").slice(0, 300)}`
    );
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.request("PUT", `/${this.bucket}/${key}`, body, contentType);
    if (res.status !== 200) {
      throw new StorageUnavailableError(`Object put failed for ${key}: ${res.status}`);
    }
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.request("GET", `/${this.bucket}/${key}`, null);
    if (res.status !== 200) {
      throw new StorageUnavailableError(`Object get failed for ${key}: ${res.status}`);
    }
    return res.body;
  }

  async deleteObject(key: string): Promise<void> {
    const res = await this.request("DELETE", `/${this.bucket}/${key}`, null);
    if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
      throw new StorageUnavailableError(`Object delete failed for ${key}: ${res.status}`);
    }
  }
}

const sha256Hex = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

const hmacSha256 = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();

const encodeRfc3986 = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

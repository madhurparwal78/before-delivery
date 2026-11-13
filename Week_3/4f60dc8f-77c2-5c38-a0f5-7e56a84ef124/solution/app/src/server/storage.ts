// MinIO over the S3 API with AWS Signature V4; every failure to reach it is `storage_unavailable`.
import { createHash, createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

const UNSIGNED = "UNSIGNED-PAYLOAD";

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function objectPath(key: string | null): string {
  const bucket = `/${encodeSegment(config.s3.bucket)}`;
  return key === null ? bucket : `${bucket}/${key.split("/").map(encodeSegment).join("/")}`;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

type S3Request = { method: string; key: string | null; query?: Record<string, string>; body?: Buffer; headers?: Record<string, string> };

async function s3(request: S3Request): Promise<Response> {
  const endpoint = new URL(config.s3.endpoint);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const canonicalPath = objectPath(request.key);
  const query = Object.entries(request.query ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`)
    .join("&");
  const payloadHash = request.body ? createHash("sha256").update(request.body).digest("hex") : UNSIGNED;
  const headers: Record<string, string> = { host: endpoint.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...(request.headers ?? {}) };
  const signedNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lowered = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const canonical = [request.method, canonicalPath, query, signedNames.map((h) => `${h}:${lowered[h]}\n`).join(""), signedNames.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash("sha256").update(canonical).digest("hex")}`;
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(`${config.s3.endpoint}${canonicalPath}${query ? `?${query}` : ""}`, {
      method: request.method,
      headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedNames.join(";")}, Signature=${signature}` },
      ...(request.body ? { body: request.body } : {}),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ApiError("storage_unavailable");
  }
}

async function expectOk(response: Response): Promise<Response> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError("storage_unavailable");
  }
  return response;
}

function xmlValue(xml: string, tag: string): string | null {
  return new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1] ?? null;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await expectOk(await s3({ method: "PUT", key, body, headers: { "content-type": contentType } }));
}

/** A multipart upload under one key; parts are sent as they fill, and `abort` removes every trace. */
export class MultipartUpload {
  private uploadId: string | null = null;
  private readonly etags: string[] = [];

  constructor(private readonly key: string, private readonly contentType: string) {}

  get started(): boolean {
    return this.uploadId !== null;
  }

  async part(body: Buffer): Promise<void> {
    if (this.uploadId === null) {
      const created = await expectOk(await s3({ method: "POST", key: this.key, query: { uploads: "" }, headers: { "content-type": this.contentType } }));
      this.uploadId = xmlValue(await created.text(), "UploadId");
      if (this.uploadId === null) throw new ApiError("storage_unavailable");
    }
    const response = await expectOk(await s3({ method: "PUT", key: this.key, query: { partNumber: String(this.etags.length + 1), uploadId: this.uploadId }, body }));
    this.etags.push(response.headers.get("etag") ?? "");
  }

  async complete(): Promise<void> {
    if (this.uploadId === null) throw new Error("no parts");
    const parts = this.etags.map((etag, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${etag}</ETag></Part>`).join("");
    const body = Buffer.from(`<CompleteMultipartUpload>${parts}</CompleteMultipartUpload>`);
    const response = await expectOk(await s3({ method: "POST", key: this.key, query: { uploadId: this.uploadId }, body }));
    const text = await response.text();
    if (text.includes("<Error>")) throw new ApiError("storage_unavailable");
  }

  async abort(): Promise<void> {
    if (this.uploadId === null) return;
    const response = await s3({ method: "DELETE", key: this.key, query: { uploadId: this.uploadId } }).catch(() => null);
    await response?.body?.cancel();
  }
}

/** The stored object's byte size, or null when it does not exist. */
export async function objectSize(key: string): Promise<number | null> {
  const response = await s3({ method: "HEAD", key });
  if (response.status === 404) return null;
  await expectOk(response);
  return Number(response.headers.get("content-length"));
}

export async function getObject(key: string, range?: { start: number; end: number }): Promise<{ stream: Readable; size: number }> {
  const response = await expectOk(await s3({ method: "GET", key, headers: range ? { range: `bytes=${range.start}-${range.end}` } : {} }));
  if (!response.body) throw new ApiError("storage_unavailable");
  return { stream: Readable.fromWeb(response.body), size: Number(response.headers.get("content-length")) };
}

export async function getObjectBytes(key: string, range?: { start: number; end: number }): Promise<Buffer> {
  const { stream } = await getObject(key, range);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  const response = await s3({ method: "DELETE", key }).catch(() => null);
  await response?.body?.cancel();
}

export async function storageReachable(): Promise<boolean> {
  try {
    const response = await s3({ method: "HEAD", key: null });
    return response.ok;
  } catch {
    return false;
  }
}

import { createHash, createHmac, randomBytes } from "node:crypto";
import { Config } from "./config";

export class StorageUnavailable extends Error {}

interface S3Request {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  key: string;
  body?: Buffer;
  contentType?: string;
  timeoutMs?: number;
}

export interface S3Object {
  data: Buffer;
  contentType: string;
}

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

async function s3Request(config: Config, req: S3Request): Promise<Response> {
  const url = new URL(`${config.s3Endpoint}/${config.s3Bucket}/${req.key}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(req.body ?? Buffer.alloc(0));
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (req.contentType) headers["content-type"] = req.contentType;

  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join("");
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalRequest = [
    req.method,
    url.pathname,
    "", // no query
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${config.s3Region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");

  const kDate = hmac(hmac(`AWS4${config.s3SecretAccessKey}`, dateStamp), config.s3Region);
  const kSigning = hmac(hmac(kDate, "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headerList = Object.entries(headers).map(([k, v]): [string, string] => [k, v]);
  return fetch(url, {
    method: req.method,
    headers: headerList,
    body: req.body ?? undefined,
    signal: AbortSignal.timeout(req.timeoutMs ?? 8000),
  });
}

export async function ensureBucket(config: Config): Promise<void> {
  try {
    const res = await s3Request(config, { method: "HEAD", key: "" });
    if (res.status === 404) {
      // Create the private bucket.
      const url = new URL(`${config.s3Endpoint}/${config.s3Bucket}`);
      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
      const dateStamp = amzDate.slice(0, 8);
      const payload = Buffer.from(
        `<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${config.s3Region}</LocationConstraint></CreateBucketConfiguration>`,
      );
      const payloadHash = sha256Hex(payload);
      const headers: Record<string, string> = {
        host: url.host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
      };
      const signedHeaderKeys = Object.keys(headers).sort();
      const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join("");
      const signedHeaders = signedHeaderKeys.join(";");
      const canonicalRequest = ["PUT", `/${config.s3Bucket}`, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
      const scope = `${dateStamp}/${config.s3Region}/s3/aws4_request`;
      const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
      const kDate = hmac(hmac(`AWS4${config.s3SecretAccessKey}`, dateStamp), config.s3Region);
      const kSigning = hmac(hmac(kDate, "s3"), "aws4_request");
      const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
      headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
      await fetch(url, {
        method: "PUT",
        headers: Object.entries(headers).map(([k, v]): [string, string] => [k, v]),
        body: payload,
        signal: AbortSignal.timeout(8000),
      });
    }
  } catch {
    // MinIO down at boot; features degrade and recover later.
  }
}

export async function putObject(config: Config, key: string, data: Buffer, contentType: string): Promise<void> {
  let res: Response;
  try {
    res = await s3Request(config, { method: "PUT", key, body: data, contentType });
  } catch {
    throw new StorageUnavailable("File storage is unavailable.");
  }
  if (!res.ok) throw new StorageUnavailable("File storage is unavailable.");
}

export async function getObject(config: Config, key: string): Promise<S3Object> {
  let res: Response;
  try {
    res = await s3Request(config, { method: "GET", key });
  } catch {
    throw new StorageUnavailable("File storage is unavailable.");
  }
  if (!res.ok) throw new StorageUnavailable("File storage is unavailable.");
  const data = Buffer.from(await res.arrayBuffer());
  return { data, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}

export function randomObjectSuffix(): string {
  return randomBytes(12).toString("hex");
}

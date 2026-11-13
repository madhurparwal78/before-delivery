// MinIO over the S3 REST API, signed with AWS Signature Version 4.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config";

export class StorageUnavailable extends Error {}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const encode = (segment: string) =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface S3Response {
  status: number;
  headers: Headers;
  body: Buffer;
}

async function s3(method: string, key: string | null, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<S3Response> {
  const { endpoint, bucket, region, accessKeyId, secretAccessKey, forcePathStyle } = config.s3;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const objectPath = key === null ? "" : `/${key.split("/").map(encode).join("/")}`;
  const path = forcePathStyle ? `/${encode(bucket)}${objectPath}` : objectPath || "/";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const sent = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host"));
  let response: Response;
  try {
    response = await fetch(`${base.protocol}//${host}${path}`, {
      method,
      headers: {
        ...sent,
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
      },
      body: method === "PUT" ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new StorageUnavailable("storage is unreachable");
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (response.status >= 500) throw new StorageUnavailable(`storage answered ${response.status}`);
  return { status: response.status, headers: response.headers, body: data };
}

const objectKey = (photoId: string) => `photos/${photoId}`;

/** Creates the bucket when it does not exist yet. */
export async function ensureBucket(): Promise<void> {
  const head = await s3("HEAD", null);
  if (head.status === 404) await s3("PUT", null);
}

/** Size of the stored object, or null when it does not exist. */
export async function storedSize(photoId: string): Promise<number | null> {
  const head = await s3("HEAD", objectKey(photoId));
  if (head.status === 404) return null;
  if (head.status !== 200) throw new StorageUnavailable(`HEAD answered ${head.status}`);
  return Number(head.headers.get("content-length") ?? "-1");
}

/** Stores the bytes unchanged with their declared content type, then reads back existence and size. */
export async function putPhoto(photoId: string, data: Buffer, contentType: string): Promise<void> {
  const put = await s3("PUT", objectKey(photoId), data, contentType);
  if (put.status !== 200) throw new StorageUnavailable(`PUT answered ${put.status}`);
  if ((await storedSize(photoId)) !== data.length) throw new StorageUnavailable("stored object not confirmed");
}

export async function getPhoto(photoId: string): Promise<Buffer | null> {
  const got = await s3("GET", objectKey(photoId));
  if (got.status === 404) return null;
  if (got.status !== 200) throw new StorageUnavailable(`GET answered ${got.status}`);
  return got.body;
}

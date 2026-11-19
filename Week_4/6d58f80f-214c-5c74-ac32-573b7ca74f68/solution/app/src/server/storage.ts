// MinIO object storage over the S3 API, signed with AWS Signature V4 (brief: Services). File bytes live only here,
// at `files/<file id>`; the browser never receives a storage URL.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

/** Storage could not be reached, or answered with a server error. */
export class StorageUnavailable extends Error {}

/** Storage answered, and refused. */
export class StorageRefused extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`storage refused: ${status} ${code}`);
  }
}

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.storage;
const base = new URL(endpoint);
const TIMEOUT_MS = 20_000;

export function objectKey(fileId: string): string {
  return `files/${fileId}`;
}

function encode(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

interface Call {
  method: "GET" | "PUT" | "POST" | "DELETE" | "HEAD";
  key?: string;
  query?: Record<string, string>;
  body?: Buffer;
  headers?: Record<string, string>;
}

async function call({ method, key, query = {}, body, headers = {} }: Call): Promise<Response> {
  const objectPath = key === undefined ? "" : `/${key.split("/").map(encode).join("/")}`;
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `${base.pathname.replace(/\/$/, "")}/${encode(bucket)}${objectPath}` : objectPath || "/";
  const canonicalQuery = Object.keys(query).sort()
    .map((name) => `${encode(name)}=${encode(query[name] ?? "")}`).join("&");
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const signed: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
  const names = Object.keys(signed).sort();
  const canonical = [method, path, canonicalQuery, names.map((n) => `${n}:${signed[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const url = `${base.protocol}//${host}${path}${canonicalQuery ? `?${canonicalQuery}` : ""}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...headers,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": stamp,
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
      },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new StorageUnavailable("storage unreachable");
  }
  if (response.status >= 500) {
    await response.body?.cancel();
    throw new StorageUnavailable(`storage answered ${response.status}`);
  }
  return response;
}

function tag(xml: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];
}

async function expectOk(response: Response, allowed: number[] = []): Promise<string> {
  const text = await response.text();
  if (response.ok || allowed.includes(response.status)) {
    const code = tag(text, "Code");
    if (text.includes("<Error>") && code) throw new StorageRefused(response.status, code);
    return text;
  }
  throw new StorageRefused(response.status, tag(text, "Code") ?? "Unknown");
}

export async function ping(): Promise<boolean> {
  try {
    const response = await call({ method: "HEAD" });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await call({ method: "HEAD" });
  await head.body?.cancel();
  if (head.ok) return;
  if (head.status !== 404) throw new StorageRefused(head.status, "HeadBucket");
  await expectOk(await call({ method: "PUT" }), [409]);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await expectOk(await call({ method: "PUT", key, body, headers: { "content-type": contentType } }));
}

/** The stored size of an object, or null when there is none. */
export async function headObject(key: string): Promise<number | null> {
  const response = await call({ method: "HEAD", key });
  await response.body?.cancel();
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageRefused(response.status, "HeadObject");
  return Number(response.headers.get("content-length"));
}

export async function getObject(key: string): Promise<Response> {
  const response = await call({ method: "GET", key });
  if (!response.ok) {
    await response.body?.cancel();
    throw new StorageRefused(response.status, "GetObject");
  }
  return response;
}

export async function deleteObject(key: string): Promise<void> {
  await expectOk(await call({ method: "DELETE", key }), [404]);
}

export async function createMultipart(key: string, contentType: string): Promise<string> {
  const xml = await expectOk(await call({ method: "POST", key, query: { uploads: "" }, headers: { "content-type": contentType } }));
  const id = tag(xml, "UploadId");
  if (!id) throw new StorageRefused(200, "NoUploadId");
  return id;
}

export async function uploadPart(key: string, uploadId: string, n: number, body: Buffer): Promise<string> {
  const response = await call({ method: "PUT", key, query: { partNumber: String(n), uploadId }, body });
  await expectOk(response);
  const etag = response.headers.get("etag");
  if (!etag) throw new StorageRefused(response.status, "NoETag");
  return etag;
}

export async function completeMultipart(key: string, uploadId: string, parts: { n: number; etag: string }[]): Promise<void> {
  const body = Buffer.from(`<CompleteMultipartUpload>${parts
    .map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</ETag></Part>`)
    .join("")}</CompleteMultipartUpload>`);
  await expectOk(await call({ method: "POST", key, query: { uploadId }, body, headers: { "content-type": "application/xml" } }));
}

/** Removes a multipart session and its parts; an already-finished session is not an error. */
export async function abortMultipart(key: string, uploadId: string): Promise<void> {
  const response = await call({ method: "DELETE", key, query: { uploadId } });
  if (response.status === 404) {
    await response.body?.cancel();
    return;
  }
  await expectOk(response);
}

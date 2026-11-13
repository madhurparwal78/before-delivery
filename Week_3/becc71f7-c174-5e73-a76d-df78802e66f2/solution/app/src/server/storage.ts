// MinIO over S3's REST interface, signed with AWS Signature Version 4.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config";

export class StorageDown extends Error {}

const TIMEOUT_MS = 8000;
const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeSegment = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface S3Request {
  method: string;
  key?: string;
  query?: Record<string, string>;
  body?: Buffer;
  contentType?: string;
}

async function send({ method, key = "", query = {}, body = Buffer.alloc(0), contentType }: S3Request): Promise<Response> {
  const base = new URL(endpoint);
  const path = `${forcePathStyle ? `/${bucket}` : ""}/${key.split("/").map(encodeSegment).join("/")}`.replace(/\/$/, key ? "/" : "");
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const search = Object.entries(query)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, value]) => `${encodeSegment(name)}=${encodeSegment(value)}`)
    .join("&");
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payload = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payload, "x-amz-date": stamp };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonical = [method, path || "/", search, ...Object.keys(headers).sort().map((name) => `${name}:${headers[name]}`), "", signedHeaders, payload].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = hmac(signingKey, ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n")).toString("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  try {
    return await fetch(`${base.protocol}//${host}${path || "/"}${search ? `?${search}` : ""}`, {
      method,
      headers: { ...headers, Authorization: authorization, ...(contentType ? { "Content-Type": contentType } : {}) },
      ...(body.length ? { body: new Uint8Array(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new StorageDown(String(error));
  }
}

let bucketReady = false;

/** Creates this copy's bucket when it is missing; the answer is kept once the bucket is known to exist. */
export async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = await send({ method: "HEAD" });
  if (head.status === 404) {
    const created = await send({ method: "PUT" });
    await created.arrayBuffer();
    if (!created.ok && created.status !== 409) throw new StorageDown(`bucket create answered ${created.status}`);
  } else if (!head.ok) {
    throw new StorageDown(`bucket check answered ${head.status}`);
  }
  bucketReady = true;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  const response = await send({ method: "PUT", key, body, contentType });
  await response.arrayBuffer();
  if (!response.ok) throw new StorageDown(`PUT answered ${response.status}`);
}

export async function getObject(key: string): Promise<Buffer> {
  await ensureBucket();
  const response = await send({ method: "GET", key });
  if (!response.ok) throw new StorageDown(`GET answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  await ensureBucket();
  const response = await send({ method: "DELETE", key });
  await response.arrayBuffer();
  if (!response.ok && response.status !== 404) throw new StorageDown(`DELETE answered ${response.status}`);
}

export async function listKeys(prefix: string): Promise<string[]> {
  await ensureBucket();
  const response = await send({ method: "GET", query: { "list-type": "2", prefix } });
  const text = await response.text();
  if (!response.ok) throw new StorageDown(`LIST answered ${response.status}`);
  return [...text.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]);
}

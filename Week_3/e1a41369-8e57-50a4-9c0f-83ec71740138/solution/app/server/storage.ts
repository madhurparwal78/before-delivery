import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { Refusal } from "./errors.js";

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
const TIMEOUT_MS = 5000;

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeSegment = (segment: string): string => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface Signed {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, key: string, body: Buffer, contentType?: string): Signed {
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${encodeSegment(bucket)}${key ? `/${key.split("/").map(encodeSegment).join("/")}` : ""}` : `/${key.split("/").map(encodeSegment).join("/")}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((name) => `${name}:${headers[name]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return { url: `${base.protocol}//${host}${path}`, headers };
}

async function call(method: string, key: string, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<Response> {
  const signed = sign(method, key, body, contentType);
  const headers = Object.fromEntries(Object.entries(signed.headers).filter(([name]) => name !== "host"));
  return fetch(signed.url, { method, headers, body: method === "PUT" ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  let response: Response;
  try {
    response = await call("PUT", key, bytes, contentType);
  } catch {
    throw Refusal.storageUnavailable();
  }
  if (!response.ok) throw Refusal.storageUnavailable();
}

export async function getObject(key: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await call("GET", key);
  } catch {
    throw Refusal.storageUnavailable();
  }
  if (!response.ok) throw Refusal.storageUnavailable();
  return Buffer.from(await response.arrayBuffer());
}

/** Whether the object store answers; creates the bucket when it is missing. */
export async function storageReachable(): Promise<boolean> {
  try {
    const head = await call("HEAD", "");
    if (head.status === 404) return (await call("PUT", "")).ok;
    return head.ok;
  } catch {
    return false;
  }
}

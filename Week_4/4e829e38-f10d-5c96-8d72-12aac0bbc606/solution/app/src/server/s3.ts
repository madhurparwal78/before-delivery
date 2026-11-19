/** A minimal S3 client (path-style SigV4) for the object store. */
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { realNow } from "./clock.js";

export class StorageUnavailable extends Error {}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

const encodeSegment = (segment: string) =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function target(key: string): { url: string; host: string; path: string } {
  const { endpoint, bucket, pathStyle } = config.s3;
  const base = new URL(endpoint);
  const objectPath = key ? `/${key.split("/").map(encodeSegment).join("/")}` : "";
  if (pathStyle) {
    const path = `/${encodeSegment(bucket)}${objectPath}`;
    return { url: `${base.origin}${path}`, host: base.host, path };
  }
  const host = `${bucket}.${base.host}`;
  return { url: `${base.protocol}//${host}${objectPath || "/"}`, host, path: objectPath || "/" };
}

async function send(method: string, key: string, body?: Uint8Array, contentType?: string): Promise<Response> {
  const { host, url, path } = target(key);
  const instant = realNow().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = instant.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": instant };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const canonical = [method, path, "", canonicalHeaders, names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", instant, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  delete headers.host;
  try {
    return await fetch(url, { method, headers, body: body as BodyInit | undefined, signal: AbortSignal.timeout(2500) });
  } catch {
    throw new StorageUnavailable();
  }
}

export async function reachable(): Promise<boolean> {
  try {
    return (await send("HEAD", "")).status === 200;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  try {
    if ((await send("HEAD", "")).status === 404) await send("PUT", "");
  } catch {
    /* the store may come up later; health reports it */
  }
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const response = await send("PUT", key, body, contentType);
  if (!response.ok) throw new StorageUnavailable();
  const confirmed = await send("HEAD", key);
  if (!confirmed.ok) throw new StorageUnavailable();
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send("GET", key);
  if (!response.ok) throw new StorageUnavailable();
  return Buffer.from(await response.arrayBuffer());
}

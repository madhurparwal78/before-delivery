import { createHash, createHmac } from "node:crypto";
import { config } from "./config.ts";

/** MinIO over S3 with signature v4, path style. Reachability is remembered and re-checked on every request. */

const REQUEST_TIMEOUT_MS = 3000;
let reachable = true;

export function storageReachable(): boolean {
  return reachable;
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encode(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

interface Answer {
  status: number;
  body: Uint8Array;
}

async function request(method: string, key: string, query: Record<string, string> = {}, body: Uint8Array = new Uint8Array()): Promise<Answer> {
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.storage;
  const base = new URL(endpoint);
  const url = forcePathStyle ? base : new URL(`${base.protocol}//${bucket}.${base.host}`);
  const objectPath = key ? `/${key.split("/").map(encode).join("/")}` : "";
  const path = forcePathStyle ? `/${bucket}${objectPath}` : objectPath || "/";
  const canonicalQuery = Object.entries(query)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, value]) => `${encode(name)}=${encode(value)}`)
    .join("&");
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
  const signedHeaders = Object.keys(headers).join(";");
  const canonical = [
    method,
    path,
    canonicalQuery,
    Object.entries(headers).map(([name, value]) => `${name}:${value}\n`).join(""),
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonical)].join("\n");
  const signingKey = [day, region, "s3", "aws4_request"].reduce<Buffer | string>((k, part) => hmac(k, part), `AWS4${secretAccessKey}`);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  try {
    const response = await fetch(`${url.origin}${path}${canonicalQuery ? `?${canonicalQuery}` : ""}`, {
      method,
      headers,
      body: method === "PUT" ? Buffer.from(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const answer = { status: response.status, body: new Uint8Array(await response.arrayBuffer()) };
    reachable = true;
    return answer;
  } catch (error) {
    reachable = false;
    throw error;
  }
}

/** Writes an object; resolves true when storage confirmed it, false when storage could not be reached or refused. */
export async function putObject(key: string, body: Uint8Array): Promise<boolean> {
  try {
    return (await request("PUT", key, {}, body)).status === 200;
  } catch {
    return false;
  }
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  try {
    const answer = await request("GET", key);
    return answer.status === 200 ? answer.body : null;
  } catch {
    return null;
  }
}

/** Creates the bucket when it does not exist yet; any answer from the server counts as reachable. */
export async function probeStorage(): Promise<void> {
  try {
    const answer = await request("HEAD", "");
    if (answer.status === 404) await request("PUT", "");
  } catch {
    reachable = false;
  }
}

export async function emptyBucket(): Promise<void> {
  for (;;) {
    const listing = await request("GET", "", { "list-type": "2" });
    const keys = [...new TextDecoder().decode(listing.body).matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => decodeXml(m[1] ?? ""));
    if (keys.length === 0) return;
    await Promise.all(keys.map((key) => request("DELETE", key)));
  }
}

function decodeXml(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

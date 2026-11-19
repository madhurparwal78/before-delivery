import { createHash, createHmac } from "node:crypto";
import { config, PROVIDER_TIMEOUT_MS } from "../config";

/** The file store cannot be reached or refused the call. */
export class StoreUnavailable extends Error {}

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeSegment = (segment: string): string => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Where an object, or the bucket itself when `key` is empty, lives: path style `/bucket/key` or virtual-host style `bucket.host/key`. */
function locate(key: string): { host: string; path: string } {
  const endpoint = new URL(config.s3Endpoint);
  return config.s3ForcePathStyle
    ? { host: endpoint.host, path: `/${config.s3Bucket}${key ? `/${key}` : ""}` }
    : { host: `${config.s3Bucket}.${endpoint.host}`, path: `/${key}` };
}

async function signedFetch(method: string, key: string, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<Response> {
  const { protocol } = new URL(config.s3Endpoint);
  const { host, path } = locate(key);
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const encodedPath = path.split("/").map(encodeSegment).join("/");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": sha256(body), "x-amz-date": stamp };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, encodedPath, "", names.map((name) => `${name}:${headers[name]}\n`).join(""), names.join(";"), headers["x-amz-content-sha256"]].join("\n");
  const scope = `${day}/${config.s3Region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3SecretAccessKey}`, day), config.s3Region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  try {
    return await fetch(`${protocol}//${host}${encodedPath}`, {
      method, headers, body: body.length > 0 ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new StoreUnavailable();
  }
}

async function createBucket(): Promise<void> {
  const created = await signedFetch("PUT", "");
  if (!created.ok && created.status !== 409) throw new StoreUnavailable();
}

/** Stores an object in the private bucket, creating the bucket on first use. */
export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  let answer = await signedFetch("PUT", key, bytes, contentType);
  if (answer.status === 404) {
    await createBucket();
    answer = await signedFetch("PUT", key, bytes, contentType);
  }
  if (!answer.ok) throw new StoreUnavailable();
}

export async function getObject(key: string): Promise<Buffer | null> {
  const answer = await signedFetch("GET", key);
  if (answer.status === 404) return null;
  if (!answer.ok) throw new StoreUnavailable();
  return Buffer.from(await answer.arrayBuffer());
}

export async function storeReachable(): Promise<boolean> {
  try {
    const answer = await signedFetch("HEAD", "");
    return answer.ok || answer.status === 404;
  } catch {
    return false;
  }
}

import { createHash, createHmac } from "node:crypto";
import { settings } from "./config";

/** MinIO cannot be reached, or answered with a server failure. */
export class StorageUnavailable extends Error {}

const REQUEST_TIMEOUT_MS = 6000;

const sha256Hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

const encodeSegment = (part: string): string =>
  encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function signedRequest(method: string, key: string, query: Record<string, string>, payload: Uint8Array): { url: string; headers: Record<string, string> } {
  const { endpoint, bucket, pathStyle, region, accessKeyId, secretAccessKey } = settings.s3;
  const base = new URL(endpoint);
  const host = pathStyle ? base.host : `${bucket}.${base.host}`;
  const path = (pathStyle ? `/${bucket}${key ? `/${key}` : ""}` : `/${key}`).split("/").map(encodeSegment).join("/");
  const search = Object.entries(query)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`)
    .join("&");
  const moment = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = moment.slice(0, 8);
  const payloadHash = sha256Hex(payload);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonical = [method, path, search, `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${moment}\n`, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", moment, scope, sha256Hex(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  return {
    url: `${base.protocol}//${host}${path}${search ? `?${search}` : ""}`,
    headers: {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": moment,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function send(method: string, key: string, payload: Uint8Array = new Uint8Array(0), query: Record<string, string> = {}): Promise<Response> {
  const { url, headers } = signedRequest(method, key, query, payload);
  try {
    const response = await fetch(url, {
      method,
      headers: method === "PUT" ? { ...headers, "content-type": "application/octet-stream" } : headers,
      body: method === "PUT" ? payload : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status >= 500) throw new StorageUnavailable(`storage answered ${response.status}`);
    probe = { at: Date.now(), reachable: true };
    return response;
  } catch (error) {
    probe = { at: Date.now(), reachable: false };
    throw error instanceof StorageUnavailable ? error : new StorageUnavailable(String(error));
  }
}

export async function putObject(key: string, bytes: Uint8Array): Promise<void> {
  const response = await send("PUT", key, bytes);
  if (!response.ok) throw new StorageUnavailable(`storage refused the object: ${response.status}`);
}

/** The object's bytes, or null when the bucket has no such key. */
export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send("GET", key);
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable(`storage refused the read: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send("DELETE", key);
  if (!response.ok && response.status !== 404) throw new StorageUnavailable(`storage refused the delete: ${response.status}`);
}

/** Every key under a prefix, following continuation tokens. */
export async function listObjects(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token = "";
  for (;;) {
    const response = await send("GET", "", new Uint8Array(0), { "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) });
    if (!response.ok) throw new StorageUnavailable(`storage refused the listing: ${response.status}`);
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(unescapeXml(match[1] as string));
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
    if (!next) return keys;
    token = unescapeXml(next[1] as string);
  }
}

const unescapeXml = (text: string): string =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Creates the bucket when it is missing; called at serve and again by the probe until it succeeds. */
async function ensureBucket(): Promise<boolean> {
  const head = await send("HEAD", "");
  if (head.ok) return true;
  const created = await send("PUT", "");
  return created.ok || created.status === 409;
}

const PROBE_MAX_AGE_MS = 2000;
let probe = { at: 0, reachable: false };
let probing: Promise<boolean> | null = null;

/** Whether the bucket answers. The answer is at most two seconds old; callers share one in-flight probe. */
export function storageReachable(): Promise<boolean> {
  if (Date.now() - probe.at < PROBE_MAX_AGE_MS) return Promise.resolve(probe.reachable);
  probing ??= ensureBucket()
    .catch(() => false)
    .then((reachable) => {
      probe = { at: Date.now(), reachable };
      probing = null;
      return reachable;
    });
  return probing;
}

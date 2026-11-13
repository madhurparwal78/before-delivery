import { createHash, createHmac } from "node:crypto";
import { config, LIMITS } from "./config";
import { StorageUnavailable } from "./errors";

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Uint8Array | string, data: string) => createHmac("sha256", key).update(data).digest();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export const strokeKey = (accountId: string, observationId: string, sha: string) =>
  `observers/${accountId}/strokes/${observationId}/${sha}.json`;
export const rasterKey = (accountId: string, observationId: string, sha: string) =>
  `observers/${accountId}/rasters/${observationId}/${sha}.png`;
export const pdfKey = (accountId: string, packetId: string, sha: string) =>
  `observers/${accountId}/packets/${packetId}/${sha}.pdf`;
export const pdfPrefix = (accountId: string, packetId: string) => `observers/${accountId}/packets/${packetId}/`;
export const strokePrefix = (accountId: string, observationId: string) => `observers/${accountId}/strokes/${observationId}/`;
export const rasterPrefix = (accountId: string, observationId: string) => `observers/${accountId}/rasters/${observationId}/`;

interface Reply {
  status: number;
  body: Buffer;
  headers: Headers;
}

/** One signed request to the bucket; every failure to get an answer is StorageUnavailable. */
async function call(method: string, key: string, options: { query?: Record<string, string>; body?: Uint8Array; contentType?: string } = {}): Promise<Reply> {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.s3;
  const url = new URL(endpoint);
  const path = `/${bucket}${key ? `/${key.split("/").map(encode).join("/")}` : ""}`;
  const query = Object.entries(options.query ?? {})
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(options.body ?? "");
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signed = Object.keys(headers).sort().join(";");
  const canonical = [method, path, query, Object.keys(headers).sort().map((h) => `${h}:${headers[h]}\n`).join(""), signed, payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const sendHeaders: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  };
  if (options.contentType) sendHeaders["content-type"] = options.contentType;
  try {
    const response = await fetch(`${endpoint}${path}${query ? `?${query}` : ""}`, {
      method,
      headers: sendHeaders,
      body: options.body ? Buffer.from(options.body) : undefined,
      signal: AbortSignal.timeout(LIMITS.providerSeconds * 1000),
    });
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: response.headers };
  } catch {
    throw new StorageUnavailable();
  }
}

function succeeded(reply: Reply, ...allowed: number[]): Reply {
  if (!allowed.includes(reply.status)) throw new StorageUnavailable();
  return reply;
}

export async function putObject(key: string, data: Uint8Array, contentType: string): Promise<void> {
  succeeded(await call("PUT", key, { body: data, contentType }), 200);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const reply = succeeded(await call("GET", key), 200, 404);
  return reply.status === 404 ? null : reply.body;
}

export async function headObject(key: string): Promise<{ size: number; etag: string } | null> {
  const reply = succeeded(await call("HEAD", key), 200, 404);
  if (reply.status === 404) return null;
  return { size: Number(reply.headers.get("content-length")), etag: (reply.headers.get("etag") ?? "").replace(/"/g, "") };
}

export async function deleteObject(key: string): Promise<void> {
  succeeded(await call("DELETE", key), 200, 204, 404);
}

export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const query: Record<string, string> = { "list-type": "2", prefix };
    if (token) query["continuation-token"] = token;
    const xml = succeeded(await call("GET", "", { query }), 200).body.toString("utf8");
    for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(decodeXml(m[1] ?? ""));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? decodeXml(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") : undefined;
  } while (token);
  return keys;
}

function decodeXml(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export const digest = sha256;
export const md5 = (data: Uint8Array) => createHash("md5").update(data).digest("hex");

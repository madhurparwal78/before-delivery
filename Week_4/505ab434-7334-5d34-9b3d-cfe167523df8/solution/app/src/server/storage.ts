// MinIO over the S3 API with Signature V4 (no SDK). Any transport failure is a StorageUnavailable.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.ts";

export class StorageUnavailable extends Error {}

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encode = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const TIMEOUT_MS = 5000;

async function request(method: string, key: string, options: { query?: Record<string, string>; body?: Buffer; contentType?: string; timeoutMs?: number } = {}): Promise<Response> {
  const { s3 } = config;
  const objectPath = key ? `/${key.split("/").map(encode).join("/")}` : "";
  const endpoint = new URL(s3.endpoint);
  const host = s3.forcePathStyle ? endpoint.host : `${s3.bucket}.${endpoint.host}`;
  const path = s3.forcePathStyle ? `/${s3.bucket}${objectPath}` : objectPath || "/";
  const query = Object.entries(options.query ?? {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .join("&");
  const body = options.body ?? Buffer.alloc(0);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
  if (options.contentType) headers["content-type"] = options.contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, query, names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${s3.secretAccessKey}`, day), s3.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  try {
    return await fetch(`${endpoint.protocol}//${host}${path}${query ? `?${query}` : ""}`, {
      method,
      headers,
      body: method === "PUT" ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
  } catch {
    throw new StorageUnavailable("storage is unreachable");
  }
}

async function expectOk(response: Response, what: string): Promise<Response> {
  if (!response.ok) throw new StorageUnavailable(`${what} answered ${response.status}`);
  return response;
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const response = await request("PUT", key, { body: bytes, contentType });
  await expectOk(response, `PUT ${key}`);
}

/** The object's stream and length, or null when it does not exist. */
export async function getObject(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null> {
  const response = await request("GET", key);
  if (response.status === 404) return null;
  await expectOk(response, `GET ${key}`);
  return { body: response.body!, size: Number(response.headers.get("content-length") ?? 0) };
}

export async function readObject(key: string): Promise<Buffer | null> {
  const response = await request("GET", key);
  if (response.status === 404) return null;
  await expectOk(response, `GET ${key}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The stored byte length, or null when the object does not exist. */
export async function objectSize(key: string): Promise<number | null> {
  const response = await request("HEAD", key);
  if (response.status === 404) return null;
  await expectOk(response, `HEAD ${key}`);
  return Number(response.headers.get("content-length") ?? 0);
}

export async function deleteObject(key: string): Promise<void> {
  const response = await request("DELETE", key);
  if (response.status !== 404) await expectOk(response, `DELETE ${key}`);
}

export async function listKeys(prefix = ""): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const query: Record<string, string> = { "list-type": "2", prefix };
    if (token) query["continuation-token"] = token;
    const response = await expectOk(await request("GET", "", { query }), "list");
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(match[1].replace(/&amp;/g, "&"));
    token = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1];
  } while (token);
  return keys;
}

/** Health: the bucket answers within one second. */
export async function storageReachable(): Promise<boolean> {
  try {
    const response = await request("HEAD", "", { timeoutMs: 800 });
    return response.ok;
  } catch {
    return false;
  }
}

export const masterKey = (assetId: string, fileName: string): string => `masters/${assetId}/${fileName}`;
export const derivativeKey = (assetId: string, variantKey: string | null, fileName: string): string =>
  `derivatives/${assetId}/${variantKey ?? "base"}/${fileName}`;
export const proofKey = (grantId: string, proofId: string): string => `proofs/${grantId}/${proofId}`;

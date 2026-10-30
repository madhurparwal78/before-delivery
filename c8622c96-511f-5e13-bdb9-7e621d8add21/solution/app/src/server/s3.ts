// MinIO / S3 over plain HTTP with AWS Signature Version 4, including presigned GET links for grants.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { ApiError } from "./http.js";

const { s3 } = config;
const TIMEOUT_MS = 10_000;

export const storageUnavailable = (): ApiError =>
  new ApiError(503, "storage_unavailable", "Image storage is unreachable. Try again shortly.");

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encode = (text: string): string =>
  encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (key: string): string => key.split("/").map(encode).join("/");

function target(key: string): { host: string; path: string; origin: string } {
  const url = new URL(s3.endpoint);
  if (s3.forcePathStyle) {
    return { host: url.host, origin: url.origin, path: `/${encode(s3.bucket)}/${encodePath(key)}` };
  }
  return { host: `${s3.bucket}.${url.host}`, origin: `${url.protocol}//${s3.bucket}.${url.host}`, path: `/${encodePath(key)}` };
}

function signingKey(day: string): Buffer {
  let key = hmac(`AWS4${s3.secretAccessKey}`, day);
  for (const part of [s3.region, "s3", "aws4_request"]) key = hmac(key, part);
  return key;
}

const amzDate = (at: Date): string => at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params).sort().map((k) => `${encode(k)}=${encode(params[k] ?? "")}`).join("&");
}

interface S3Response {
  status: number;
  body: Buffer;
  headers: Headers;
}

async function request(method: string, key: string, body: Buffer = Buffer.alloc(0),
  extra: Record<string, string> = {}): Promise<S3Response> {
  const { host, path, origin } = target(key);
  const now = new Date();
  const stamp = amzDate(now);
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp, ...extra };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v.trim();
  const canonical = [method, path, "", names.map((h) => `${h}:${lower[h]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signature = hmac(signingKey(day), toSign).toString("hex");
  const sent: Record<string, string> = { ...headers };
  delete sent.host;
  sent.Authorization = `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  try {
    const response = await fetch(`${origin}${path}`, {
      method, headers: sent, body: method === "PUT" ? body : undefined, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: response.headers };
  } catch {
    throw storageUnavailable();
  }
}

function ensureOk(response: S3Response, allowed: number[] = []): void {
  if (response.status >= 500) throw storageUnavailable();
  if (response.status >= 300 && !allowed.includes(response.status)) {
    throw new Error(`storage answered ${response.status}`);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  ensureOk(await request("PUT", key, body, { "content-type": contentType }));
}

/** The object's bytes, or null when it does not exist. */
export async function getObject(key: string): Promise<Buffer | null> {
  const response = await request("GET", key);
  ensureOk(response, [404]);
  return response.status === 404 ? null : response.body;
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await request("HEAD", key);
  ensureOk(response, [404]);
  return response.status !== 404;
}

export async function deleteObject(key: string): Promise<void> {
  ensureOk(await request("DELETE", key), [404]);
}

/** Server-side copy then delete: moves an object under a new key. Missing sources are skipped. */
export async function moveObject(from: string, to: string): Promise<void> {
  const response = await request("PUT", to, Buffer.alloc(0), {
    "x-amz-copy-source": `/${encode(s3.bucket)}/${encodePath(from)}`,
  });
  ensureOk(response, [404]);
  if (response.status !== 404) await deleteObject(from);
}

/**
 * A presigned GET for exactly one key, signed at real time with `seconds` of validity and the response
 * overrides baked into the signature, so changing any part of the link makes storage refuse it.
 */
export function presignGet(key: string, seconds: number, overrides: Record<string, string>): string {
  const { host, path, origin } = target(key);
  const stamp = amzDate(new Date());
  const day = stamp.slice(0, 8);
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${s3.accessKeyId}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(seconds),
    "X-Amz-SignedHeaders": "host",
    ...overrides,
  };
  const queryString = canonicalQuery(params);
  const canonical = ["GET", path, queryString, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signature = hmac(signingKey(day), toSign).toString("hex");
  return `${origin}${path}?${queryString}&X-Amz-Signature=${signature}`;
}

export const keys = {
  original: (essayId: string, frameId: string): string => `originals/${essayId}/${frameId}`,
  derivative: (essayId: string, frameId: string, variant: string): string => `derivatives/${essayId}/${frameId}/${variant}.jpg`,
  grant: (licenceId: string): string => `grants/${licenceId}.json`,
  legalHold: (essayId: string, frameId: string): string => `legal-hold/${essayId}/${frameId}`,
};

export const VARIANTS = ["grid", "story", "preview"] as const;
export type Variant = (typeof VARIANTS)[number];

import { createHmac, createHash } from "node:crypto";
import { s3 } from "./config.ts";
import { logger } from "./logger.ts";

function utf8(str: string): Buffer {
  return Buffer.from(str, "utf8");
}

function sha256hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function uriEncode(str: string): string {
  let out = "";
  for (const ch of str) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch;
    else if (ch === "/") out += "%2F";
    else for (const byte of utf8(ch)) out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export type PutResult = { ok: true } | { ok: false; status: number };

async function request(method: string, key: string, body?: Buffer, contentType?: string, query?: Record<string, string>): Promise<{ status: number; headers: Headers; body: Buffer }> {
  const url = new URL(s3.endpoint);
  const path = `/${s3.bucket}/${key.split("/").map(uriEncode).join("/")}`;
  const search = new URLSearchParams(query ?? {});
  const canonicalQuery = [...search.entries()].map(([k, v]) => [uriEncode(k), uriEncode(v)] as const).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const host = url.host;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "").replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, "$1$2$3T$4$5$6Z");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = body ? sha256hex(body) : sha256hex("");
  const headersList: [string, string][] = [
    ["host", host],
    ["x-amz-content-sha256", payloadHash],
    ["x-amz-date", amzDate],
  ];
  if (contentType) headersList.push(["content-type", contentType]);
  const signedHeaders = headersList.map(([k]) => k).sort().join(";");
  const canonicalHeaders = headersList.map(([k, v]) => `${k}:${v}\n`).sort().join("");
  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${s3.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${s3.secretAccessKey}`, dateStamp), s3.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`${url.origin}${path}${canonicalQuery ? `?${canonicalQuery}` : ""}`, {
    method,
    headers: {
      authorization,
      ...Object.fromEntries(headersList.map(([k, v]) => [k, v])),
      ...(contentType ? { "content-type": contentType } : {}),
    },
    body: body === undefined ? undefined : new Uint8Array(body),
    signal: AbortSignal.timeout(10_000),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, body: buffer };
}

export async function put(key: string, body: Buffer, contentType = "application/octet-stream"): Promise<boolean> {
  try {
    const { status } = await request("PUT", key, body, contentType);
    return status === 200;
  } catch (err) {
    logger.warn(`s3 put ${key}: ${(err as Error).message}`);
    return false;
  }
}

export async function get(key: string): Promise<Buffer | null> {
  try {
    const { status, body } = await request("GET", key);
    return status === 200 ? body : null;
  } catch (err) {
    logger.warn(`s3 get ${key}: ${(err as Error).message}`);
    return null;
  }
}

export async function head(key: string): Promise<{ exists: boolean; unavailable: boolean }> {
  try {
    const { status } = await request("HEAD", key);
    return { exists: status === 200, unavailable: false };
  } catch (err) {
    logger.warn(`s3 head ${key}: ${(err as Error).message}`);
    return { exists: false, unavailable: true };
  }
}

export async function remove(key: string): Promise<void> {
  try {
    await request("DELETE", key);
  } catch (err) {
    logger.warn(`s3 delete ${key}: ${(err as Error).message}`);
  }
}

export async function createBucket(): Promise<boolean> {
  try {
    const { status, body } = await request("PUT", "", undefined, undefined, undefined);
    if (status === 200) return true;
    // A pre-existing bucket answers 409 with a BucketAlreadyOwnedByYou error.
    if (status === 409 && body.includes("BucketAlreadyOwnedByYou")) return true;
    logger.warn(`s3 createBucket status ${status}`);
    return false;
  } catch (err) {
    logger.warn(`s3 createBucket: ${(err as Error).message}`);
    return false;
  }
}

export function checkpointKey(notebookId: string, checkpointId: string): string {
  return `notebooks/${notebookId}/checkpoints/${checkpointId}.json`;
}

export function originalKey(notebookId: string): string {
  return `notebooks/${notebookId}/original.ipynb`;
}

export function exportKey(notebookId: string, exportId: string): string {
  return `notebooks/${notebookId}/exports/${exportId}.ipynb`;
}

export function attachmentKey(notebookId: string, cellId: string, name: string): string {
  return `notebooks/${notebookId}/attachments/${cellId}/${name}`;
}

export function workingKey(notebookId: string): string {
  return `notebooks/${notebookId}/working.json`;
}

import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { AwsV4Signer } from "aws4fetch";
import { config } from "./config.js";

export class StorageUnavailable extends Error {}

const TIMEOUT_MS = 8000;

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function encode(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function target(key: string): URL {
  const base = new URL(config.s3.endpoint);
  const path = key.split("/").map(encode).join("/");
  if (config.s3.forcePathStyle) {
    return new URL(`${base.origin}/${encode(config.s3.bucket)}${key ? `/${path}` : ""}`);
  }
  return new URL(`${base.protocol}//${config.s3.bucket}.${base.host}/${path}`);
}

interface StorageResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

// Requests go through node:http rather than fetch: fetch refuses some ports outright, and storage may sit on any.
function request(url: URL, method: string, headers: Record<string, string>, body: Buffer): Promise<StorageResponse> {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const outgoing = transport.request(url, { method, headers, timeout: TIMEOUT_MS }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    outgoing.on("timeout", () => outgoing.destroy(new Error("storage timeout")));
    outgoing.on("error", reject);
    outgoing.end(method === "PUT" ? body : undefined);
  });
}

async function send(
  method: string,
  key: string,
  options: { query?: Record<string, string>; body?: Buffer; headers?: Record<string, string> } = {},
): Promise<StorageResponse> {
  const url = target(key);
  for (const [name, value] of Object.entries(options.query ?? {})) url.searchParams.append(name, value);
  const body = options.body ?? Buffer.alloc(0);
  const signed = await new AwsV4Signer({
    method,
    url: url.toString(),
    headers: options.headers,
    body: new Uint8Array(body),
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
    service: "s3",
    region: config.s3.region,
  }).sign();
  const headers: Record<string, string> = Object.fromEntries(signed.headers.entries());
  if (method === "PUT") headers["content-length"] = String(body.length);
  let response: StorageResponse;
  try {
    response = await request(new URL(signed.url), method, headers, body);
  } catch {
    throw new StorageUnavailable(`storage request failed: ${method}`);
  }
  if (response.status >= 500 || response.status === 403 || response.status === 400) {
    throw new StorageUnavailable(`storage answered ${response.status} to ${method}`);
  }
  return response;
}

export function checksumOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("base64");
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const result = await send("PUT", key, {
    body: bytes,
    headers: { "content-type": contentType, "x-amz-checksum-sha256": checksumOf(bytes) },
  });
  if (result.status !== 200) throw new StorageUnavailable(`put answered ${result.status}`);
}

/** The SHA-256 checksum storage reports for an object (base64), "" when it has none, or null when absent. */
export async function storedChecksum(key: string): Promise<string | null> {
  const result = await send("HEAD", key, { headers: { "x-amz-checksum-mode": "ENABLED" } });
  if (result.status === 404) return null;
  if (result.status !== 200) throw new StorageUnavailable(`head answered ${result.status}`);
  const checksum = result.headers["x-amz-checksum-sha256"];
  return typeof checksum === "string" ? checksum : "";
}

export async function getObject(key: string): Promise<Buffer | null> {
  const result = await send("GET", key);
  if (result.status === 404) return null;
  if (result.status !== 200) throw new StorageUnavailable(`get answered ${result.status}`);
  return result.body;
}

export async function deleteObject(key: string): Promise<void> {
  await send("DELETE", key);
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const query: Record<string, string> = { "list-type": "2", prefix };
    if (token) query["continuation-token"] = token;
    const result = await send("GET", "", { query });
    if (result.status !== 200) throw new StorageUnavailable(`list answered ${result.status}`);
    const xml = result.body.toString("utf8");
    for (const match of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) keys.push(unescapeXml(match[1]!));
    const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) && next ? unescapeXml(next[1]!) : undefined;
  } while (token);
  return keys;
}

export async function reachable(): Promise<boolean> {
  try {
    const result = await send("HEAD", "");
    return result.status === 200;
  } catch {
    return false;
  }
}

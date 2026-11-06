// The S3 bucket (MinIO): AWS Signature Version 4 requests to the configured endpoint.

import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { storageUnavailable } from "./errors.js";

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function objectUrl(key: string, query: Record<string, string>): URL {
  const base = new URL(endpoint);
  const path = key.split("/").map(encodeSegment).join("/");
  const url = forcePathStyle
    ? new URL(`${base.origin}/${bucket}${key ? `/${path}` : ""}`)
    : new URL(`${base.protocol}//${bucket}.${base.host}/${path}`);
  for (const [name, value] of Object.entries(query).sort(([a], [b]) => (a < b ? -1 : 1))) {
    url.searchParams.append(name, value);
  }
  return url;
}

async function signedRequest(method: string, key: string, body: Buffer = Buffer.alloc(0),
  query: Record<string, string> = {}, contentType?: string): Promise<Response> {
  const url = objectUrl(key, query);
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;
  const signedNames = Object.keys(headers).sort();
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([name, value]) => `${encodeSegment(name)}=${encodeSegment(value)}`)
    .sort()
    .join("&");
  const canonical = [
    method,
    url.pathname,
    canonicalQuery,
    signedNames.map((name) => `${name}:${headers[name]}\n`).join(""),
    signedNames.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonical)}`;
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const sent: Record<string, string> = { ...headers };
  delete sent.host;
  try {
    return await fetch(url, {
      method,
      headers: {
        ...sent,
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedNames.join(";")}, Signature=${signature}`,
      },
      body: method === "PUT" ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw storageUnavailable();
  }
}

async function expectOk(response: Response): Promise<Response> {
  if (!response.ok) {
    console.error(`storage ${response.status}: ${(await response.text()).slice(0, 300)}`);
    throw storageUnavailable();
  }
  return response;
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  await expectOk(await signedRequest("PUT", key, data, {}, contentType));
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await signedRequest("GET", key);
  if (response.status === 404) return null;
  return Buffer.from(await (await expectOk(response)).arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await signedRequest("DELETE", key);
  if (response.status !== 404) await expectOk(response);
}

async function listKeys(prefix: string): Promise<string[]> {
  const response = await expectOk(await signedRequest("GET", "", Buffer.alloc(0), { "list-type": "2", prefix }));
  const xml = await response.text();
  return [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

export async function deletePrefix(prefix: string): Promise<void> {
  for (const key of await listKeys(prefix)) await deleteObject(key);
}


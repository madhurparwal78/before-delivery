import { createHash, createHmac } from "node:crypto";
import { config } from "../config";
import { report } from "./status";

const REQUEST_TIMEOUT_MS = 5000;

export class StorageError extends Error {}

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encode = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function target(key: string): { host: string; path: string; base: string } {
  const endpoint = new URL(config.s3.endpoint);
  const bucket = config.s3.bucket;
  const keyPath = key.split("/").map(encode).join("/");
  if (config.s3.forcePathStyle) {
    return { host: endpoint.host, path: `${endpoint.pathname.replace(/\/$/, "")}/${bucket}${key ? `/${keyPath}` : ""}`, base: endpoint.origin };
  }
  return { host: `${bucket}.${endpoint.host}`, path: `${endpoint.pathname.replace(/\/$/, "")}/${keyPath}`, base: `${endpoint.protocol}//${bucket}.${endpoint.host}` };
}

async function call(method: "GET" | "PUT" | "DELETE", key: string, options: { query?: Record<string, string>; body?: Buffer; contentType?: string } = {}): Promise<Response> {
  const { host, path, base } = target(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(options.body ?? "");
  const query = Object.entries(options.query ?? {})
    .map(([name, value]) => [encode(name), encode(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signed = Object.keys(headers).sort().join(";");
  const canonical = [method, path, query, Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join(""), signed, payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey: Buffer = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${createHmac("sha256", signingKey).update(toSign).digest("hex")}`;
  const { host: _host, ...sent } = headers;
  try {
    const response = await fetch(`${base}${path}${query ? `?${query}` : ""}`, {
      method,
      headers: { ...sent, authorization, ...(options.contentType ? { "content-type": options.contentType } : {}) },
      body: options.body ? new Uint8Array(options.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    report("storage", true);
    return response;
  } catch (error) {
    report("storage", false);
    throw new StorageError(error instanceof Error ? error.message : "storage unreachable");
  }
}

function expect(response: Response, ...statuses: number[]): void {
  if (!statuses.includes(response.status)) {
    report("storage", false);
    throw new StorageError(`storage answered ${response.status}`);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  expect(await call("PUT", key, { body, contentType }), 200);
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await call("GET", key);
  expect(response, 200);
  return Buffer.from(await response.arrayBuffer());
}

async function keysUnder(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const response = await call("GET", "", { query: { "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) } });
    expect(response, 200);
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] : undefined;
  } while (token);
  return keys;
}

/** Removes every object whose key starts with the prefix. */
export async function deletePrefix(prefix: string): Promise<void> {
  for (const key of await keysUnder(prefix)) expect(await call("DELETE", key), 204, 200);
}

export async function ping(): Promise<void> {
  expect(await call("GET", "", { query: { "list-type": "2", "max-keys": "1" } }), 200);
}

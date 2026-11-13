import { createHash, createHmac } from "node:crypto";
import { PROVIDER_TIMEOUT_MS, config } from "./config.js";

// MinIO over the S3 API, signed with AWS Signature Version 4 (brief: Services, MinIO).

export class StorageUnavailable extends Error {}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function target(key: string, query: Record<string, string>): { url: string; host: string; path: string; search: string } {
  const endpoint = new URL(config.s3.endpoint);
  const objectPath = key ? `/${key.split("/").map(encode).join("/")}` : "";
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  const path = config.s3.forcePathStyle ? `/${encode(config.s3.bucket)}${objectPath || "/"}` : objectPath || "/";
  const search = Object.keys(query).sort().map((name) => `${encode(name)}=${encode(query[name] ?? "")}`).join("&");
  return { url: `${endpoint.protocol}//${host}${path}${search ? `?${search}` : ""}`, host, path, search };
}

async function send(method: string, key: string, options: { body?: Buffer; type?: string; query?: Record<string, string> } = {}) {
  const body = options.body ?? Buffer.alloc(0);
  const { url, host, path, search } = target(key, options.query ?? {});
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payload = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payload, "x-amz-date": stamp };
  if (options.type) headers["content-type"] = options.type;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, search, names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payload].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey)
    .update(`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256(canonical)}`).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  delete headers.host;
  try {
    return await fetch(url, {
      method, headers, body: method === "PUT" ? body : undefined, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new StorageUnavailable(`storage ${method} failed`);
  }
}

function expect(response: Response, ...ok: number[]): Response {
  if (!ok.includes(response.status)) throw new StorageUnavailable(`storage answered ${response.status}`);
  return response;
}

export async function putObject(key: string, data: Buffer, type: string): Promise<void> {
  expect(await send("PUT", key, { body: data, type }), 200);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send("GET", key);
  if (response.status === 404) return null;
  return Buffer.from(await expect(response, 200).arrayBuffer());
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send("HEAD", key);
  return expect(response, 200, 404).status === 200;
}

export async function deleteObject(key: string): Promise<void> {
  expect(await send("DELETE", key), 204, 200);
}

/** Removes every object under `prefix` (brief: deleting a draft removes every object under entries/<entry id>/). */
export async function deletePrefix(prefix: string): Promise<void> {
  const listing = await expect(await send("GET", "", { query: { "list-type": "2", prefix } }), 200).text();
  for (const match of listing.matchAll(/<Key>([^<]+)<\/Key>/g)) {
    await deleteObject(decodeXml(match[1] ?? ""));
  }
}

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

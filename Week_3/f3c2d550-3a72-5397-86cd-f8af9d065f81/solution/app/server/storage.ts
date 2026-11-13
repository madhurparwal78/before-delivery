import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

const TIMEOUT_MS = 8000;

export class StorageUnavailable extends Error {
  constructor(cause: unknown) {
    super("Storage is unreachable.", { cause });
  }
}

export const sha256Hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Uint8Array | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodePath = (path: string): string => path.split("/").map((part) => encodeURIComponent(part)).join("/");

function target(key: string): URL {
  const base = new URL(config.s3.endpoint);
  if (config.s3.forcePathStyle) {
    base.pathname = `/${config.s3.bucket}${key ? `/${encodePath(key)}` : ""}`;
  } else {
    base.hostname = `${config.s3.bucket}.${base.hostname}`;
    base.pathname = key ? `/${encodePath(key)}` : "/";
  }
  return base;
}

function sign(method: string, url: URL, payload: Uint8Array): Record<string, string> {
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    url.pathname,
    "",
    ...names.map((name) => `${name}:${headers[name]}`),
    "",
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonical)].join("\n");
  const signingKey = [day, config.s3.region, "s3", "aws4_request"].reduce<Buffer | string>(
    (key, part) => hmac(key, part),
    `AWS4${config.s3.secretAccessKey}`,
  );
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return headers;
}

async function send(method: string, key: string, body: Uint8Array = new Uint8Array(), contentType?: string): Promise<Response> {
  const url = target(key);
  const headers = sign(method, url, body);
  if (contentType) headers["content-type"] = contentType;
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method === "PUT" ? Buffer.from(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 500) throw new Error(`storage answered ${response.status}`);
    return response;
  } catch (error) {
    throw new StorageUnavailable(error);
  }
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const response = await send("PUT", key, body, contentType);
  if (!response.ok) throw new StorageUnavailable(new Error(`PUT ${key} answered ${response.status}`));
}

/** The stored bytes, or null when no such object exists. */
export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send("GET", key);
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable(new Error(`GET ${key} answered ${response.status}`));
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send("DELETE", key);
  if (!response.ok && response.status !== 404) throw new StorageUnavailable(new Error(`DELETE ${key} answered ${response.status}`));
}

/** Whether the stored object reads back with the same byte count and SHA-256 as `body`. */
export async function storedAs(key: string, body: Uint8Array): Promise<boolean> {
  const stored = await getObject(key);
  return stored !== null && stored.length === body.length && sha256Hex(stored) === sha256Hex(body);
}

/** Writes an object and confirms it from storage's own answer. */
export async function putConfirmed(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await putObject(key, body, contentType);
  if (!(await storedAs(key, body))) throw new StorageUnavailable(new Error(`${key} did not read back as written`));
}

/** Confirms the bucket exists, creating it when it is missing. */
export async function ensureBucket(): Promise<void> {
  const head = await send("HEAD", "");
  if (head.status === 404) {
    const created = await send("PUT", "");
    if (!created.ok) throw new StorageUnavailable(new Error(`bucket create answered ${created.status}`));
  } else if (!head.ok) {
    throw new StorageUnavailable(new Error(`bucket check answered ${head.status}`));
  }
}

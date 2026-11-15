import { createHash, createHmac } from "node:crypto";
import { config } from "./config";
import { StorageUnavailable } from "./errors";

const timeoutMs = 4000;
const emptyHash = createHash("sha256").update("").digest("hex");

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function objectUrl(key: string, query: Record<string, string> = {}): { url: URL; path: string; query: string } {
  const endpoint = new URL(config.s3.endpoint);
  const keyPath = key === "" ? "" : `/${key.split("/").map(encodeSegment).join("/")}`;
  const path = config.s3.forcePathStyle ? `/${encodeSegment(config.s3.bucket)}${keyPath}` : keyPath || "/";
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeSegment(name)}=${encodeSegment(query[name] ?? "")}`)
    .join("&");
  const url = new URL(`${endpoint.protocol}//${host}${path}${canonicalQuery ? `?${canonicalQuery}` : ""}`);
  return { url, path, query: canonicalQuery };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

async function send(method: string, key: string, options: { body?: Buffer; contentType?: string; query?: Record<string, string> } = {}): Promise<Response> {
  const { url, path, query } = objectUrl(key, options.query);
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = now.slice(0, 8);
  const payloadHash = options.body ? createHash("sha256").update(options.body).digest("hex") : emptyHash;
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": now,
  };
  if (options.contentType) headers["content-type"] = options.contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, query, names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const sent = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host"));
  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...sent,
        authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
      },
      body: options.body ? new Uint8Array(options.body) : null,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 500 || response.status === 403) {
      await response.arrayBuffer().catch(() => undefined);
      throw new StorageUnavailable(`storage answered ${response.status}`);
    }
    return response;
  } catch (error) {
    if (error instanceof StorageUnavailable) throw error;
    throw new StorageUnavailable(error instanceof Error ? error.message : "storage request failed");
  }
}

async function expectOk(response: Response, action: string): Promise<void> {
  const text = await response.text();
  if (!response.ok) throw new StorageUnavailable(`${action} answered ${response.status}: ${text.slice(0, 200)}`);
}

export async function ensureBucket(): Promise<void> {
  const head = await send("HEAD", "");
  await head.arrayBuffer();
  if (head.ok) return;
  if (head.status !== 404) throw new StorageUnavailable(`bucket check answered ${head.status}`);
  const created = await send("PUT", "");
  await expectOk(created, "bucket create");
}

export async function storageReachable(): Promise<boolean> {
  try {
    const head = await send("HEAD", "");
    await head.arrayBuffer();
    return head.ok || head.status === 404;
  } catch {
    return false;
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await expectOk(await send("PUT", key, { body, contentType }), `put ${key}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send("GET", key);
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  if (!response.ok) {
    await response.arrayBuffer();
    throw new StorageUnavailable(`get ${key} answered ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send("HEAD", key);
  await response.arrayBuffer();
  if (response.status === 404) return false;
  if (!response.ok) throw new StorageUnavailable(`head ${key} answered ${response.status}`);
  return true;
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const query: Record<string, string> = { "list-type": "2", prefix };
    if (token) query["continuation-token"] = token;
    const response = await send("GET", "", { query });
    const xml = await response.text();
    if (!response.ok) throw new StorageUnavailable(`list ${prefix} answered ${response.status}`);
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(decodeXml(match[1] ?? ""));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? decodeXml(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") : undefined;
  } while (token);
  return keys;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

export async function deletePrefix(prefix: string): Promise<void> {
  for (const key of await listKeys(prefix)) {
    const response = await send("DELETE", key);
    await response.arrayBuffer();
    if (!response.ok && response.status !== 404) throw new StorageUnavailable(`delete ${key} answered ${response.status}`);
  }
}

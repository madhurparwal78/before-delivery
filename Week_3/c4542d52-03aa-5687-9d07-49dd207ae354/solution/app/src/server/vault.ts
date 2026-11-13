import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { vaultUnavailable } from "./errors.js";

const TIMEOUT_MS = 5000;
const CONTENT_TYPE = "text/plain; charset=utf-8";

const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodePath = (path: string): string =>
  path
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");

function target(key: string): { url: string; host: string; path: string } {
  const endpoint = new URL(config.vault.endpoint);
  if (config.vault.forcePathStyle) {
    const path = encodePath(`/${config.vault.bucket}${key ? `/${key}` : ""}`);
    return { url: `${endpoint.origin}${path}`, host: endpoint.host, path };
  }
  const host = `${config.vault.bucket}.${endpoint.host}`;
  const path = encodePath(`/${key}`);
  return { url: `${endpoint.protocol}//${host}${path}`, host, path };
}

async function signedRequest(method: "GET" | "PUT", key: string, body: Uint8Array | null): Promise<Response> {
  const { url, host, path } = target(key);
  const payloadHash = sha256Hex(body ?? "");
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
  if (body) headers["content-type"] = CONTENT_TYPE;
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    path,
    "",
    names.map((name) => `${name}:${headers[name]}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${config.vault.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonical)].join("\n");
  let signingKey = hmac(`AWS4${config.vault.secretAccessKey}`, day);
  for (const part of [config.vault.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.vault.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, { method, headers: sent, body: body ? Buffer.from(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    console.error("vault request failed", method, key, error);
    throw vaultUnavailable();
  }
}

/** The stored bytes of an object, or null when the vault holds nothing under that key. */
export async function readObject(key: string): Promise<Buffer | null> {
  const response = await signedRequest("GET", key, null);
  if (response.status === 404) return null;
  if (!response.ok) {
    console.error("vault read refused", key, response.status, await response.text());
    throw vaultUnavailable();
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Writes an object once; never replaces or deletes one that is already there. */
export async function writeObject(key: string, bytes: Uint8Array): Promise<void> {
  const existing = await readObject(key);
  if (existing !== null) return;
  let response = await signedRequest("PUT", key, bytes);
  if (response.status === 404) {
    await signedRequest("PUT", "", null);
    response = await signedRequest("PUT", key, bytes);
  }
  if (!response.ok) throw vaultUnavailable();
}

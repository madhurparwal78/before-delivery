import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";

const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";
const TIMEOUT_MS = 5000;

export class VaultUnavailableError extends Error {}

function sha256Hex(payload: string | Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}

export function sealHash(text: string): string {
  return sha256Hex(Buffer.from(text, "utf8"));
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, key: string, payload: Buffer): SignedRequest {
  const endpoint = new URL(config.vault.endpoint);
  const path = config.vault.forcePathStyle
    ? `/${config.vault.bucket}/${encodeKeyPath(key)}`
    : `/${encodeKeyPath(key)}`;
  const host = config.vault.forcePathStyle ? endpoint.host : `${config.vault.bucket}.${endpoint.host}`;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (method === "PUT") headers["content-type"] = "text/plain; charset=utf-8";

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${config.vault.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const dateKey = hmac(`AWS4${config.vault.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.vault.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  headers["authorization"] =
    `${ALGORITHM} Credential=${config.vault.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${endpoint.origin}${path}`, headers };
}

async function send(method: string, key: string, payload: Buffer): Promise<Response> {
  const request = sign(method, key, payload);
  try {
    return await fetch(request.url, {
      method,
      headers: request.headers,
      body: method === "PUT" ? payload : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new VaultUnavailableError(String(error));
  }
}

export async function putObject(key: string, text: string): Promise<void> {
  const response = await send("PUT", key, Buffer.from(text, "utf8"));
  if (!response.ok) throw new VaultUnavailableError(`vault answered ${response.status} on put`);
  await response.arrayBuffer();
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send("GET", key, Buffer.alloc(0));
  if (!response.ok) throw new VaultUnavailableError(`vault answered ${response.status} on get`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Writes the document's bytes once and reads them back. The document counts as
 * sealed only when the bytes read back hash to the same seal.
 */
export async function sealObject(key: string, text: string): Promise<string> {
  const expected = sealHash(text);
  await putObject(key, text);
  const stored = await getObject(key);
  const actual = sha256Hex(stored);
  if (actual !== expected) throw new VaultUnavailableError("the vault read back different bytes");
  return actual;
}

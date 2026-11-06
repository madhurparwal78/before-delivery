// The filing vault: an S3-compatible bucket reached with signed requests. Failures never leak
// their cause; callers see only that the vault is unavailable.

import { createHash, createHmac } from "node:crypto";
import type { Config } from "./config.ts";
import { Refusal } from "./errors.ts";

type VaultConfig = Config["vault"];

let settings: VaultConfig | null = null;
let reachable = false;

export function configureVault(config: VaultConfig): void {
  settings = config;
}

export function vaultState(): "available" | "unavailable" {
  return reachable ? "available" : "unavailable";
}

function vault(): VaultConfig {
  if (!settings) throw new Error("vault is not configured");
  return settings;
}

const EMPTY_HASH = createHash("sha256").update("").digest("hex");
const REQUEST_TIMEOUT_MS = 4000;

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

interface VaultResponse {
  status: number;
  body: Buffer;
  headers: Headers;
}

async function send(method: string, key: string | null, options: { body?: Buffer; headers?: Record<string, string> } = {}): Promise<VaultResponse> {
  const config = vault();
  const endpoint = new URL(config.endpoint);
  const host = config.forcePathStyle ? endpoint.host : `${config.bucket}.${endpoint.host}`;
  const path = config.forcePathStyle
    ? `/${encodeSegment(config.bucket)}${key === null ? "" : `/${key.split("/").map(encodeSegment).join("/")}`}`
    : `/${key === null ? "" : key.split("/").map(encodeSegment).join("/")}`;
  const body = options.body ?? Buffer.alloc(0);
  const payloadHash = options.body ? createHash("sha256").update(body).digest("hex") : EMPTY_HASH;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  for (const [name, value] of Object.entries(options.headers ?? {})) headers[name.toLowerCase()] = value;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${(headers[name] ?? "").trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const canonical = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${config.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), config.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const sendable = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host"));
  const init: RequestInit = { method, headers: sendable, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  if (options.body) init.body = new Uint8Array(options.body);
  const response = await fetch(`${endpoint.protocol}//${host}${path}`, init);
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: response.headers };
}

/** One quick retry, because a pooled connection may have been closed by the other side. */
async function attempt(method: string, key: string | null, options?: { body?: Buffer; headers?: Record<string, string> }): Promise<VaultResponse> {
  try {
    return await send(method, key, options);
  } catch {
    return send(method, key, options);
  }
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    const result = await work();
    reachable = true;
    return result;
  } catch (error) {
    if (error instanceof Refusal) throw error;
    reachable = false;
    throw new Refusal("vault_unavailable");
  }
}

class VaultFault extends Error {}

async function createBucket(): Promise<void> {
  const created = await attempt("PUT", null);
  if (created.status !== 200 && created.status !== 409) throw new VaultFault("bucket could not be created");
}

/** HEAD the bucket and create it, private, when it is missing. */
async function ensureBucket(): Promise<void> {
  const head = await attempt("HEAD", null);
  if (head.status === 200) return;
  if (head.status !== 404) throw new VaultFault("bucket check failed");
  await createBucket();
}

export async function probeVault(): Promise<boolean> {
  try {
    await guarded(ensureBucket);
    return true;
  } catch {
    return false;
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await guarded(async () => {
    let response = await attempt("PUT", key, { body, headers: { "content-type": contentType } });
    if (response.status === 404) {
      await createBucket();
      response = await attempt("PUT", key, { body, headers: { "content-type": contentType } });
    }
    if (response.status !== 200) throw new VaultFault("put failed");
  });
}

/** Writes an object only if the key is free; an existing key is kept exactly as it is. */
export async function putObjectOnce(key: string, body: Buffer, contentType: string): Promise<"created" | "exists"> {
  return guarded(async () => {
    const head = await attempt("HEAD", key);
    if (head.status === 200) return "exists";
    if (head.status !== 404) throw new VaultFault("head failed");
    const response = await attempt("PUT", key, { body, headers: { "content-type": contentType, "if-none-match": "*" } });
    if (response.status === 412 || response.status === 304) return "exists";
    if (response.status !== 200) throw new VaultFault("put failed");
    return "created";
  });
}

export async function getObject(key: string): Promise<Buffer> {
  return guarded(async () => {
    const response = await attempt("GET", key);
    if (response.status !== 200) throw new VaultFault("get failed");
    return response.body;
  });
}


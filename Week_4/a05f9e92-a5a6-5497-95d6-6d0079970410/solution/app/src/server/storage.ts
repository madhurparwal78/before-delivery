import { createHash, createHmac } from "node:crypto";
import { connection } from "./config.js";
import { publish } from "./live.js";

const region = connection.s3.region;
const bucket = connection.s3.bucket;

let redirect: string | null = null;
let reachable = false;
const recoveryHooks: Array<() => Promise<void>> = [];

export class StorageDown extends Error {}

export function isAvailable(): boolean {
  return reachable;
}

export function onRecovery(hook: () => Promise<void>): void {
  recoveryHooks.push(hook);
}

function endpoint(): string {
  return (redirect ?? connection.s3.endpoint).replace(/\/$/, "");
}

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

async function signedFetch(method: "GET" | "PUT" | "HEAD" | "DELETE", path: string, body: Buffer = Buffer.alloc(0), contentType?: string, search = ""): Promise<Response> {
  const base = endpoint();
  const url = new URL(base + encodePath(path) + (search ? `?${search}` : ""));
  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, search, names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${connection.s3.secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${connection.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return fetch(url, { method, headers, body: method === "PUT" ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(5000) });
}

function setReachable(next: boolean): void {
  if (reachable === next) return;
  reachable = next;
  publish("storage", "status", { storage: next ? "available" : "unavailable" });
  if (next) for (const hook of recoveryHooks) void hook().catch((error) => process.stderr.write(`storage recovery failed: ${String(error)}\n`));
}

/** Checks that the bucket exists; any failure marks storage unavailable until the next probe succeeds. */
export async function probe(): Promise<boolean> {
  try {
    let response = await signedFetch("HEAD", `/${bucket}`);
    if (response.status === 404) response = await signedFetch("PUT", `/${bucket}`);
    setReachable(response.ok);
  } catch {
    setReachable(false);
  }
  return reachable;
}

export async function setEndpoint(next: string | null): Promise<string> {
  redirect = next;
  await probe();
  return endpoint();
}

export async function putObject(key: string, body: Buffer | string, contentType: string): Promise<void> {
  try {
    const response = await signedFetch("PUT", `/${bucket}/${key}`, Buffer.from(body), contentType);
    if (!response.ok) throw new StorageDown(`PUT ${key} answered ${response.status}`);
    setReachable(true);
  } catch (error) {
    setReachable(false);
    throw error instanceof StorageDown ? error : new StorageDown(String(error));
  }
}

export async function getObject(key: string): Promise<Buffer> {
  try {
    const response = await signedFetch("GET", `/${bucket}/${key}`);
    if (!response.ok) throw new StorageDown(`GET ${key} answered ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    setReachable(false);
    throw error instanceof StorageDown ? error : new StorageDown(String(error));
  }
}

/** Removes every object in the bucket; used only by the grading reset. */
export async function deleteAllObjects(): Promise<void> {
  const listing = await signedFetch("GET", `/${bucket}`, Buffer.alloc(0), undefined, "list-type=2");
  if (!listing.ok) return;
  const keys = [...(await listing.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
  for (const key of keys) await signedFetch("DELETE", `/${bucket}/${key}`);
}

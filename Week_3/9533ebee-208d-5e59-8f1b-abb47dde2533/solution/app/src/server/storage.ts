import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { fail } from "./errors.js";

// Object storage for settlement statements, statement PDFs and price evidence, spoken as S3 with Signature Version 4.

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

function encodeKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}

/** The object's URL, or the bucket's own when `key` is empty. */
function target(key: string): { url: string; host: string; path: string } {
  const endpoint = new URL(config.s3.endpoint);
  const objectPath = key === "" ? "" : `/${encodeKey(key)}`;
  const path = config.s3.forcePathStyle ? `/${config.s3.bucket}${objectPath}` : objectPath || "/";
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  return { url: `${endpoint.protocol}//${host}${path}`, host, path };
}

async function request(method: "GET" | "PUT" | "HEAD" | "DELETE", key: string, body?: { data: string | Buffer; contentType: string }): Promise<Response> {
  const { url, host, path } = target(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body?.data ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (body) headers["content-type"] = body.contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", ...names.map((n) => `${n}:${headers[n]}`), "", names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  delete headers["host"];
  return fetch(url, { method, headers, body: body?.data ?? null, signal: AbortSignal.timeout(5000) });
}

let bucketReady = false;

/** Creates the bucket when it doesn't exist; once it is known to exist, later calls do nothing. */
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const found = await request("HEAD", "");
  if (found.status === 404) {
    const created = await request("PUT", "");
    if (!created.ok && created.status !== 409) throw new Error(`creating bucket ${config.s3.bucket}: ${created.status}`);
  } else if (!found.ok) {
    throw new Error(`bucket ${config.s3.bucket}: ${found.status}`);
  }
  bucketReady = true;
}

interface StoredObject {
  key: string;
  data: string;
  contentType: "application/json" | "text/plain; charset=utf-8";
}

/**
 * Writes every object or none: on any failure, objects already written are removed and the request fails with
 * statement_store_unavailable. Objects are never overwritten, because every key carries a fresh id.
 */
export async function storeAll(objects: StoredObject[]): Promise<void> {
  const written: string[] = [];
  try {
    await ensureBucket();
    for (const object of objects) {
      const response = await request("PUT", object.key, { data: object.data, contentType: object.contentType });
      if (!response.ok) throw new Error(`PUT ${object.key}: ${response.status}`);
      written.push(object.key);
    }
  } catch (error) {
    console.error("statement store unavailable:", error instanceof Error ? error.message : error);
    await removeAll(written);
    throw fail("statement_store_unavailable");
  }
}

/** Writes the statement PDF once; an object already in storage is left as it is. */
export async function storePdf(key: string, pdf: Buffer): Promise<void> {
  await ensureBucket();
  if (await exists(key)) return;
  const response = await request("PUT", key, { data: pdf, contentType: "application/pdf" });
  if (!response.ok) throw new Error(`PUT ${key}: ${response.status}`);
}

/** The object's bytes, or null when storage doesn't hold it or can't be reached. */
export async function readObject(key: string): Promise<Buffer | null> {
  try {
    const response = await request("GET", key);
    return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** Removes objects written for a request that then failed to commit. */
export async function removeAll(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => request("DELETE", key).catch(() => undefined)));
}

/** True only when storage answers, right now, that the object exists. */
export async function exists(key: string): Promise<boolean> {
  try {
    return (await request("HEAD", key)).status === 200;
  } catch {
    return false;
  }
}

/** Creates the bucket at start, and again every 10 seconds until MinIO is reachable. */
export function watchBucket(): void {
  const attempt = () => {
    ensureBucket().catch((error: unknown) => {
      console.error("bucket not ready, retrying in 10 s:", error instanceof Error ? error.message : error);
      setTimeout(attempt, 10_000);
    });
  };
  attempt();
}

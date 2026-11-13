// MinIO through the S3 API, signed with AWS Signature Version 4.
import { createHash, createHmac } from "node:crypto";
import { config, SERVICE_TIMEOUT_MS } from "./config";
import { markService, Unreachable } from "./services";

const { s3 } = config;
const endpoint = new URL(s3.endpoint);

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodePath = (p: string): string =>
  p.split("/").map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");

function target(key: string): { url: string; host: string; canonicalPath: string } {
  const suffix = key ? `/${key}` : "";
  if (s3.forcePathStyle) {
    const canonicalPath = encodePath(`${endpoint.pathname.replace(/\/$/, "")}/${s3.bucket}${suffix}`);
    return { url: `${endpoint.origin}${canonicalPath}`, host: endpoint.host, canonicalPath };
  }
  const host = `${s3.bucket}.${endpoint.host}`;
  const canonicalPath = encodePath(suffix || "/");
  return { url: `${endpoint.protocol}//${host}${canonicalPath}`, host, canonicalPath };
}

async function send(method: string, key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const { url, host, canonicalPath } = target(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signed = Object.keys(headers).sort();
  const canonical = [method, canonicalPath, "", signed.map((h) => `${h}:${headers[h] ?? ""}\n`).join(""), signed.join(";"), payloadHash].join("\n");
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  let signingKey = hmac(`AWS4${s3.secretAccessKey}`, day);
  for (const part of [s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const sent: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${signature}`,
  };
  if (contentType) sent["content-type"] = contentType;
  try {
    const response = await fetch(url, {
      method, headers: sent, signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
      ...(body ? { body: new Uint8Array(body) } : {}),
    });
    markService("storage", true);
    return response;
  } catch (error) {
    throw new Unreachable("storage", error);
  }
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const response = await send("PUT", key, bytes, contentType);
  if (!response.ok) throw new Unreachable("storage", new Error(`PUT ${key}: ${response.status}`));
}

export async function getObject(key: string): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await send("GET", key);
  if (!response.ok) throw new Unreachable("storage", new Error(`GET ${key}: ${response.status}`));
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

async function deleteObject(key: string): Promise<void> {
  const response = await send("DELETE", key);
  if (!response.ok && response.status !== 404) throw new Unreachable("storage", new Error(`DELETE ${key}: ${response.status}`));
}

/** Deletes objects, tolerating an outage: used only to undo writes of a failed request. */
export async function deleteQuietly(keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => deleteObject(k).catch((error: unknown) => {
    console.error(`could not delete ${k}:`, error instanceof Error ? error.message : String(error));
  })));
}

/** Reachability probe; creates the bucket when it does not exist yet. */
export async function probeStorage(): Promise<void> {
  const head = await send("HEAD", "");
  if (head.status === 404) {
    const made = await send("PUT", "");
    if (!made.ok && made.status !== 409) throw new Error(`bucket create failed: ${made.status}`);
  }
}

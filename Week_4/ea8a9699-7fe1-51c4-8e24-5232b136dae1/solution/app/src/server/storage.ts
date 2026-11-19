// MinIO through the S3 API, signed with SigV4 (brief: Services > MinIO). Every call tries afresh.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { Unavailable } from "./errors.js";

const TIMEOUT_MS = 15_000;

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeKey = (key: string): string =>
  key.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");

function target(key: string): URL {
  const { endpoint, bucket, forcePathStyle } = config.s3;
  const base = new URL(endpoint);
  if (forcePathStyle) return new URL(`${base.origin}/${bucket}/${encodeKey(key)}`);
  return new URL(`${base.protocol}//${bucket}.${base.host}/${encodeKey(key)}`);
}

async function signedFetch(method: string, key: string, body: Buffer | null, extra: Record<string, string> = {}): Promise<Response> {
  const url = target(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const signedNames = Object.keys(headers).sort();
  const canonical = [
    method,
    url.pathname,
    "",
    signedNames.map((name) => `${name}:${String(headers[name]).trim()}\n`).join(""),
    signedNames.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedNames.join(";")}, Signature=${signature}`;
  const sent = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host"));
  // The timeout covers reaching MinIO and its headers; a streamed body may take as long as the reader needs.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      headers: { ...sent, authorization },
      ...(body ? { body: new Uint8Array(body) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Unavailable("storage_unavailable", error);
  } finally {
    clearTimeout(timer);
  }
}

export async function putObject(key: string, data: Buffer, contentType: string, metadata: Record<string, string> = {}): Promise<void> {
  const meta = Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`x-amz-meta-${k}`, v]));
  const response = await signedFetch("PUT", key, data, { "content-type": contentType, ...meta });
  await response.arrayBuffer();
  if (!response.ok) throw new Unavailable("storage_unavailable", new Error(`PUT ${response.status}`));
}

export async function deleteObject(key: string): Promise<void> {
  const response = await signedFetch("DELETE", key, null);
  await response.arrayBuffer();
  if (!response.ok && response.status !== 404) throw new Unavailable("storage_unavailable", new Error(`DELETE ${response.status}`));
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await signedFetch("HEAD", key, null);
  await response.arrayBuffer();
  if (response.status === 404) return false;
  if (!response.ok) throw new Unavailable("storage_unavailable", new Error(`HEAD ${response.status}`));
  return true;
}

/** Streams an object; `range` is passed through so clips can be seeked. */
export async function getObject(key: string, range?: string): Promise<Response> {
  const response = await signedFetch("GET", key, null, range ? { range } : {});
  if (!response.ok && response.status !== 206) {
    await response.arrayBuffer();
    throw new Unavailable("storage_unavailable", new Error(`GET ${response.status}`));
  }
  return response;
}

export const objectKey = (workspaceSlug: string, referenceId: string, ext: string): string =>
  `references/${workspaceSlug}/${referenceId}.${ext}`;

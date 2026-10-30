// MinIO through the S3 API, signed with AWS Signature V4. Everything lives in the private bucket S3_BUCKET.
import { createHash, createHmac } from "node:crypto";
import { config } from "../config.ts";
import { ServiceDown } from "./serviceDown.ts";

const TIMEOUT_MS = 8000;
const EMPTY_SHA = createHash("sha256").update("").digest("hex");

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodePath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())).join("/");
}

function target(key: string | null): URL {
  const base = new URL(config.s3.endpoint);
  const objectPath = key === null ? "" : "/" + encodePath(key);
  if (config.s3.forcePathStyle) return new URL(`${base.origin}/${encodeURIComponent(config.s3.bucket)}${objectPath}`);
  return new URL(`${base.protocol}//${config.s3.bucket}.${base.host}${objectPath || "/"}`);
}

async function s3(method: string, key: string | null, body?: Buffer, contentType?: string): Promise<Response> {
  const url = target(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = body ? createHash("sha256").update(body).digest("hex") : EMPTY_SHA;
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash("sha256").update(canonical).digest("hex")}`;
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  delete headers.host;
  try {
    return await fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new ServiceDown("minio", error);
  }
}

async function expectOk(response: Response, what: string): Promise<Response> {
  if (response.ok) return response;
  await response.arrayBuffer();
  throw new ServiceDown("minio", new Error(`${what}: ${response.status}`));
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await (await expectOk(await s3("PUT", key, body, contentType), "PUT")).arrayBuffer();
}

export async function getObject(key: string): Promise<Buffer> {
  return Buffer.from(await (await expectOk(await s3("GET", key), "GET")).arrayBuffer());
}

async function deleteObject(key: string): Promise<void> {
  const response = await s3("DELETE", key);
  await response.arrayBuffer();
}

/** Stores every object or none: on a failure the ones already written are removed again. */
export async function putAll(objects: readonly { key: string; body: Buffer; contentType: string }[]): Promise<void> {
  const written: string[] = [];
  try {
    for (const object of objects) {
      await putObject(object.key, object.body, object.contentType);
      written.push(object.key);
    }
  } catch (error) {
    await removeAll(written);
    throw error;
  }
}

export async function removeAll(keys: readonly string[]): Promise<void> {
  for (const key of keys) await deleteObject(key).catch(() => undefined);
}

export async function storageUp(): Promise<boolean> {
  try {
    const response = await s3("HEAD", null);
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}

/** Object key layout (brief: Services — MinIO). Keys never leave the server. */
export const objectKeys = {
  pass: (ref: string, code: string) => `passes/${ref}/${code}.pdf`,
  proof: (ref: string, proofId: string) => `proofs/${ref}/${proofId}`,
  artworkOriginal: (entryId: string, imageId: string) => `artworks/originals/${entryId}/${imageId}`,
  artworkDisplay: (entryId: string, imageId: string) => `artworks/display/${entryId}/${imageId}.jpg`,
};

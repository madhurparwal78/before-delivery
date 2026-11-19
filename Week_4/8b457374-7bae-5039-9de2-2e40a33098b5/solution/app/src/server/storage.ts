import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { call } from "./status.js";

// The MinIO bucket, spoken to with AWS Signature V4. No object is public; the app streams them itself.

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
const origin = new URL(endpoint);

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function target(key: string): { url: string; host: string; path: string } {
  if (forcePathStyle) {
    const path = `/${bucket}${key ? `/${encodeKey(key)}` : ""}`;
    return { url: `${origin.origin}${path}`, host: origin.host, path };
  }
  const host = `${bucket}.${origin.host}`;
  const path = `/${encodeKey(key)}`;
  return { url: `${origin.protocol}//${host}${path}`, host, path };
}

async function s3(method: string, key: string, body: Buffer = Buffer.alloc(0), type?: string): Promise<Response> {
  const { url, host, path } = target(key);
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = now.slice(0, 8);
  const payload = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payload, "x-amz-date": now };
  if (type) headers["content-type"] = type;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", ...names.map((n) => `${n}:${headers[n]}`), "", names.join(";"), payload].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const sent = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host"));
  return call("storage", url, {
    method,
    headers: {
      ...sent,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    },
    body: body.length ? new Uint8Array(body) : undefined,
  });
}

async function expect(response: Response, ok: number[], what: string): Promise<Response> {
  if (!ok.includes(response.status)) {
    await response.body?.cancel();
    throw new Error(`storage ${what} answered ${response.status}`);
  }
  return response;
}

/** Uploads and then confirms the object by a metadata read with the same byte length. */
export async function putConfirmed(key: string, data: Buffer, type: string): Promise<void> {
  await expect(await s3("PUT", key, data, type), [200], `PUT ${key}`).then((r) => r.body?.cancel());
  const head = await expect(await s3("HEAD", key), [200], `HEAD ${key}`);
  if (Number(head.headers.get("content-length")) !== data.length) throw new Error(`storage ${key} length mismatch`);
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await expect(await s3("GET", key), [200], `GET ${key}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  await expect(await s3("DELETE", key), [204, 200, 404], `DELETE ${key}`).then((r) => r.body?.cancel());
}

export async function probe(): Promise<void> {
  await expect(await s3("HEAD", ""), [200], "HEAD bucket");
}

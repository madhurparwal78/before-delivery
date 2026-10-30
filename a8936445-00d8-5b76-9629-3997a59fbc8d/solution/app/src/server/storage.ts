// MinIO through the S3 API, signed with AWS Signature Version 4. The bucket stays private.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config";
import { ProviderError } from "./errors";
import { request } from "./outbound";

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function objectUrl(key: string): URL {
  const { endpoint, bucket, forcePathStyle } = config.s3;
  const base = new URL(endpoint);
  if (forcePathStyle) return new URL(`${base.origin}${encodePath(`/${bucket}/${key}`)}`);
  return new URL(`${base.protocol}//${bucket}.${base.host}${encodePath(`/${key}`)}`);
}

function signedHeaders(method: string, url: URL, payload: Buffer, extra: Record<string, string>): Record<string, string> {
  const { region, accessKeyId, secretAccessKey } = config.s3;
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = now.slice(0, 8);
  const payloadHash = sha256(payload);
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": now };
  for (const [name, value] of Object.entries(extra)) headers[name.toLowerCase()] = value;
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, "", names.map((n) => `${n}:${headers[n].trim()}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, sha256(canonical)].join("\n");
  let key: Buffer = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return headers;
}

async function send(method: string, key: string, body: Buffer = Buffer.alloc(0), extra: Record<string, string> = {}): Promise<{ status: number; body: Buffer }> {
  const url = objectUrl(key);
  const response = await request("storage", url.toString(), { method, headers: signedHeaders(method, url, body, extra), body: body.length ? body : undefined });
  return { status: response.status, body: response.body };
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  const response = await send("PUT", key, data, { "content-type": contentType });
  if (response.status !== 200) throw new ProviderError("storage", `PUT ${key} answered ${response.status}`);
}

/** The stored bytes, or null when the object does not exist. */
export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send("GET", key);
  if (response.status === 404) return null;
  if (response.status !== 200) throw new ProviderError("storage", `GET ${key} answered ${response.status}`);
  return response.body;
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send("DELETE", key);
  if (response.status !== 204 && response.status !== 200 && response.status !== 404) {
    throw new ProviderError("storage", `DELETE ${key} answered ${response.status}`);
  }
}

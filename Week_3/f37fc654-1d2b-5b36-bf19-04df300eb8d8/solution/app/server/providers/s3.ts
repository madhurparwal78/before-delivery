// MinIO over the S3 API, signed with AWS Signature V4 (bucket S3_BUCKET).
import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";
import { expectOk, reach } from "./reach.js";

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function objectUrl(key: string): URL {
  const path = key.split("/").map(encodeURIComponent).join("/");
  const base = new URL(config.s3.endpoint);
  if (config.s3.forcePathStyle) return new URL(`${base.origin}/${config.s3.bucket}/${path}`);
  return new URL(`${base.protocol}//${config.s3.bucket}.${base.host}/${path}`);
}

function signed(method: string, url: URL, payload: Buffer): Record<string, string> {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = now.slice(0, 8);
  const payloadHash = sha256(payload);
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": now };
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, "", ...names.map((n) => `${n}:${headers[n]}`), "", names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${now}\n${scope}\n${sha256(canonical)}`;
  let key: Buffer = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}

async function s3(method: string, key: string, body: Buffer = Buffer.alloc(0), extra: Record<string, string> = {}): Promise<Response> {
  const url = objectUrl(key);
  return reach("minio", url.href, { method, headers: { ...signed(method, url, body), ...extra }, body: method === "PUT" ? new Uint8Array(body) : undefined }, 30_000);
}

/** Stores the bytes and confirms the object's size before returning. */
export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await expectOk("minio", await s3("PUT", key, bytes, { "content-type": contentType }), 200);
  const head = await expectOk("minio", await s3("HEAD", key), 200);
  const size = Number(head.headers.get("content-length"));
  if (size !== bytes.length) throw new Error(`stored size ${size} differs from ${bytes.length}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await expectOk("minio", await s3("GET", key), 200);
  return Buffer.from(await response.arrayBuffer());
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await s3("HEAD", key);
  if (response.status === 404) return false;
  await expectOk("minio", response, 200);
  return true;
}

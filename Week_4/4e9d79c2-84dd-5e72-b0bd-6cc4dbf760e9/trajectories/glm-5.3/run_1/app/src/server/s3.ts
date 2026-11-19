import { createHash, createHmac } from "node:crypto";
import { request } from "undici";
import type { Config } from "./config.js";
import { errors } from "./errors.js";

export interface S3Result {
  statusCode: number;
  body: Buffer;
}

const TIMEOUT_MS = 5000;

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

async function s3Call(
  cfg: Config,
  method: "PUT" | "GET" | "DELETE",
  key: string,
  body?: Buffer,
  contentType?: string
): Promise<S3Result> {
  const u = new URL(cfg.s3Endpoint);
  const hostHeader = u.host;
  const bucketHost = cfg.s3PathStyle ? hostHeader : `${cfg.s3Bucket}.${hostHeader}`;
  const pathPrefix = cfg.s3PathStyle ? `/${cfg.s3Bucket}` : "";
  const canonicalUri = `${pathPrefix}/${key}`.replace(/\/{2,}/g, "/");
  const target = `http://${bucketHost}${canonicalUri}`;
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: bucketHost,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;
  const signedHeadersList = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((h) => `${h}:${headers[h]}\n`)
    .join("");
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeadersList, payloadHash].join("\n");
  const scope = `${dateStamp}/${cfg.s3Region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac("AWS4" + cfg.s3SecretAccessKey, dateStamp);
  const kRegion = hmac(kDate, cfg.s3Region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const auth = `AWS4-HMAC-SHA256 Credential=${cfg.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;
  try {
    const res = await request(target, {
      method,
      headers: { ...headers, Authorization: auth },
      body: payload.length ? payload : undefined,
      bodyTimeout: TIMEOUT_MS,
      headersTimeout: TIMEOUT_MS,
    });
    const chunks: Buffer[] = [];
    for await (const c of res.body) chunks.push(Buffer.from(c));
    return { statusCode: res.statusCode, body: Buffer.concat(chunks) };
  } catch {
    throw errors.provider("The file store is unavailable right now. Nothing was saved.");
  }
}

export async function s3Put(cfg: Config, key: string, body: Buffer, contentType: string): Promise<void> {
  const r = await s3Call(cfg, "PUT", key, body, contentType);
  if (r.statusCode !== 200) throw errors.provider("The file store is unavailable right now. Nothing was saved.");
}

export async function s3Get(cfg: Config, key: string): Promise<Buffer | null> {
  const r = await s3Call(cfg, "GET", key);
  if (r.statusCode === 200) return r.body;
  if (r.statusCode === 404) return null;
  throw errors.provider("The file store is unavailable right now. Nothing was saved.");
}

export async function s3Delete(cfg: Config, key: string): Promise<void> {
  const r = await s3Call(cfg, "DELETE", key);
  if (r.statusCode !== 204 && r.statusCode !== 404) {
    throw errors.provider("The file store is unavailable right now. Nothing was saved.");
  }
}

export async function s3DeleteList(cfg: Config, keys: string[]): Promise<void> {
  for (const k of keys) await s3Delete(cfg, k);
}

export function objectKeyForPaper(deskId: string, operatorId: string, kind: string, paperId: string): string {
  return `desks/${deskId}/operators/${operatorId}/${kind}/${paperId}`;
}

export function objectKeyForPassengers(deskId: string, hireId: string, listId: string): string {
  listId = listId.endsWith(".csv") ? listId : listId + ".csv";
  return `desks/${deskId}/passengers/${hireId}/${listId}`;
}

export function objectKeyForDocument(deskId: string, documentId: string): string {
  return `desks/${deskId}/documents/${documentId}.pdf`;
}

import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";
import { storageUnavailable } from "../http/errors.js";

// Minimal S3 client (AWS Signature V4) for MinIO: certificate PDFs and completion exports.

const TIMEOUT_MS = 6000;

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function target(key: string): { url: string; host: string; path: string } {
  const endpoint = new URL(config.s3.endpoint);
  const objectPath = key.split("/").map(encodeSegment).join("/");
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  const path = config.s3.forcePathStyle ? `/${encodeSegment(config.s3.bucket)}/${objectPath}` : `/${objectPath}`;
  return { url: `${endpoint.protocol}//${host}${path}`, host, path };
}

async function signedRequest(method: "GET" | "PUT" | "HEAD", key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const { url, host, path } = target(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", ...names.map((n) => `${n}:${headers[n] ?? ""}`), "", names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const signingKey = ["s3", "aws4_request"].reduce<Buffer>((k, part) => hmac(k, part), hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region));
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const sent: Record<string, string> = {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
  delete sent.host;
  try {
    return await fetch(url, { method, headers: sent, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    console.error(`object storage ${method} ${key} unreachable:`, error instanceof Error ? error.message : String(error));
    throw storageUnavailable();
  }
}

async function rejectUnless(response: Response, ok: number[], what: string): Promise<void> {
  if (ok.includes(response.status)) return;
  console.error(`object storage ${what} answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  throw storageUnavailable();
}

/** Stores an object once; an object already at the key is never overwritten. */
export async function putOnce(key: string, body: Buffer, contentType: string): Promise<void> {
  const head = await signedRequest("HEAD", key);
  if (head.status === 200) return;
  await rejectUnless(head, [404], `HEAD ${key}`);
  const put = await signedRequest("PUT", key, body, contentType);
  await rejectUnless(put, [200], `PUT ${key}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await signedRequest("GET", key);
  await rejectUnless(response, [200], `GET ${key}`);
  return Buffer.from(await response.arrayBuffer());
}

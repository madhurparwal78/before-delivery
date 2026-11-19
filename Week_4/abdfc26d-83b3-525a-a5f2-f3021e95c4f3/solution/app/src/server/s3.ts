import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { ProviderDown } from "./errors.js";

// A SigV4 client for the three object calls the app makes and for presigned GET links.

const s3 = config.s3;
const endpoint = new URL(s3.endpoint);

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeSegment = (part: string): string => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function target(key: string): { host: string; path: string } {
  const encoded = key.split("/").map(encodeSegment).join("/");
  return s3.forcePathStyle
    ? { host: endpoint.host, path: `/${s3.bucket}/${encoded}` }
    : { host: `${s3.bucket}.${endpoint.host}`, path: `/${encoded}` };
}

const signingKey = (day: string): Buffer => hmac(hmac(hmac(hmac(`AWS4${s3.secretAccessKey}`, day), s3.region), "s3"), "aws4_request");

function stamp(now: Date): { amzDate: string; day: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, day: amzDate.slice(0, 8) };
}

const canonicalQuery = (query: Record<string, string>): string =>
  Object.keys(query)
    .sort()
    .map((key) => `${encodeSegment(key)}=${encodeSegment(query[key] ?? "")}`)
    .join("&");

async function request(method: "PUT" | "GET" | "HEAD", key: string, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<Response> {
  const { host, path } = target(key);
  const { amzDate, day } = stamp(new Date());
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  const signature = createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  const init: RequestInit = {
    method,
    headers: { ...sent, Authorization: `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
    signal: AbortSignal.timeout(20_000),
  };
  if (method === "PUT") init.body = body;
  try {
    const response = await fetch(`${endpoint.protocol}//${host}${path}`, init);
    if (response.status >= 500) throw new ProviderDown("minio", `${method} HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (error instanceof ProviderDown) throw error;
    throw new ProviderDown("minio", error instanceof Error ? error.message : String(error));
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await request("PUT", key, body, contentType);
  if (!response.ok) throw new ProviderDown("minio", `PUT ${key}: HTTP ${response.status}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await request("GET", key);
  if (!response.ok) throw new ProviderDown("minio", `GET ${key}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function objectExists(key: string): Promise<boolean> {
  return (await request("HEAD", key)).ok;
}

/** A presigned GET link on S3_ENDPOINT that downloads as `filename`, valid for PRESIGN_SECONDS. */
export function presign(key: string, filename: string): { url: string; expires_in: number } {
  const seconds = config.presignSeconds;
  const { host, path } = target(key);
  const { amzDate, day } = stamp(new Date());
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${s3.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(seconds),
    "X-Amz-SignedHeaders": "host",
    "response-content-disposition": `attachment; filename="${filename.replace(/["\\]/g, "")}"`,
  };
  const qs = canonicalQuery(query);
  const canonical = ["GET", path, qs, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  const signature = createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
  return { url: `${endpoint.protocol}//${host}${path}?${qs}&X-Amz-Signature=${signature}`, expires_in: seconds };
}

export async function reachable(): Promise<boolean> {
  try {
    await fetch(`${s3.endpoint}/minio/health/live`, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

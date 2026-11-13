import { createHash, createHmac } from "node:crypto";
import { config } from "./config";

export class StorageDown extends Error {
  constructor(cause?: unknown) {
    super("storage unreachable", { cause });
  }
}

const { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.s3;
const host = new URL(endpoint).host;
const REQUEST_TIMEOUT_MS = 20_000;

const sha256Hex = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function encode(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const encodePath = (key: string): string => key.split("/").map(encode).join("/");

function canonicalQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((name) => `${encode(name)}=${encode(query[name] ?? "")}`)
    .join("&");
}

function signingKey(day: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
}

function stamp(): { amz: string; day: string } {
  const amz = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  return { amz, day: amz.slice(0, 8) };
}

function objectPath(key: string): string {
  return key ? `/${bucket}/${encodePath(key)}` : `/${bucket}`;
}

interface S3Response {
  status: number;
  body: Buffer;
  headers: Headers;
}

async function send(
  method: string,
  key: string,
  options: { query?: Record<string, string>; body?: Buffer; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<S3Response> {
  const query = options.query ?? {};
  const body = options.body ?? Buffer.alloc(0);
  const { amz, day } = stamp();
  const payload = sha256Hex(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payload, "x-amz-date": amz };
  const signedNames = Object.keys(headers).sort();
  const canonical = [
    method,
    objectPath(key),
    canonicalQuery(query),
    signedNames.map((name) => `${name}:${headers[name]}\n`).join(""),
    signedNames.join(";"),
    payload,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${sha256Hex(canonical)}`;
  const signature = createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedNames.join(";")}, Signature=${signature}`;
  const queryString = canonicalQuery(query);
  const url = `${endpoint}${objectPath(key)}${queryString ? `?${queryString}` : ""}`;
  try {
    const response = await fetch(url, {
      method,
      headers: { ...headers, ...options.headers, authorization },
      body: method === "PUT" || method === "POST" ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: response.headers };
  } catch (error) {
    throw new StorageDown(error);
  }
}

function expectOk(response: S3Response, what: string): S3Response {
  if (response.status >= 500) throw new StorageDown(`${what}: ${response.status}`);
  if (response.status >= 300) throw new Error(`${what} failed with ${response.status}: ${response.body.toString().slice(0, 200)}`);
  return response;
}

export async function putObject(key: string, body: Buffer): Promise<void> {
  expectOk(await send("PUT", key, { body }), `put ${key}`);
}

/** The object's bytes, or null when it does not exist. `range` is inclusive of both ends. */
export async function getObject(key: string, range?: { start: number; end: number }): Promise<Buffer | null> {
  const response = await send("GET", key, range ? { headers: { range: `bytes=${range.start}-${range.end}` } } : {});
  if (response.status === 404) return null;
  return expectOk(response, `get ${key}`).body;
}

export async function headObject(key: string): Promise<{ size: number } | null> {
  const response = await send("HEAD", key);
  if (response.status === 404) return null;
  expectOk(response, `head ${key}`);
  return { size: Number(response.headers.get("content-length") ?? 0) };
}

export async function deleteObject(key: string): Promise<void> {
  expectOk(await send("DELETE", key), `delete ${key}`);
}

/** True when the bucket answers; the short timeout keeps outage answers quick. */
export async function reachable(): Promise<boolean> {
  try {
    const response = await send("HEAD", "", { timeoutMs: 1500 });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** Creates the bucket when storage answers but the bucket does not exist yet. */
export async function ensureBucket(): Promise<void> {
  const head = await send("HEAD", "");
  if (head.status === 404) expectOk(await send("PUT", ""), "create bucket");
}

export async function createMultipart(key: string): Promise<string> {
  const response = expectOk(await send("POST", key, { query: { uploads: "" } }), "create multipart");
  const id = /<UploadId>(.*?)<\/UploadId>/.exec(response.body.toString("utf8"))?.[1];
  if (!id) throw new Error("multipart upload id missing");
  return id;
}

export async function uploadPart(key: string, uploadId: string, part: number, body: Buffer): Promise<string> {
  const response = expectOk(
    await send("PUT", key, { query: { partNumber: String(part), uploadId }, body }),
    `upload part ${part}`,
  );
  return response.headers.get("etag") ?? "";
}

export async function completeMultipart(key: string, uploadId: string, etags: string[]): Promise<void> {
  const parts = etags.map((etag, index) => `<Part><PartNumber>${index + 1}</PartNumber><ETag>${etag}</ETag></Part>`).join("");
  const body = Buffer.from(`<CompleteMultipartUpload>${parts}</CompleteMultipartUpload>`);
  expectOk(await send("POST", key, { query: { uploadId }, body }), "complete multipart");
}

export async function abortMultipart(key: string, uploadId: string): Promise<void> {
  await send("DELETE", key, { query: { uploadId } }).catch(() => undefined);
}

/** A presigned GET link that expires after `seconds`: the one value allowed to reach the browser. */
export function presignGet(key: string, seconds: number): string {
  const { amz, day } = stamp();
  const scope = `${day}/${region}/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${scope}`,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(seconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonical = ["GET", objectPath(key), canonicalQuery(query), `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${sha256Hex(canonical)}`;
  const signature = createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
  return `${endpoint}${objectPath(key)}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}

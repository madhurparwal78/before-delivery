// MinIO / S3 object storage over fetch with AWS signature v4, plus the switch the grading route flips.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config";

export class StorageUnavailable extends Error {}

const REQUEST_TIMEOUT_MS = 4000;
let switchedDown = false;

export function setStorageDown(down: boolean): void {
  switchedDown = down;
}

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeSegment = (segment: string): string => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function target(key: string): { url: string; host: string; path: string } {
  const base = new URL(config.s3.endpoint);
  const objectPath = key ? `/${key.split("/").map(encodeSegment).join("/")}` : "";
  if (config.s3.forcePathStyle) {
    const path = `/${config.s3.bucket}${objectPath}`;
    return { url: `${base.origin}${path}`, host: base.host, path };
  }
  const host = `${config.s3.bucket}.${base.host}`;
  return { url: `${base.protocol}//${host}${objectPath || "/"}`, host, path: objectPath || "/" };
}

async function send(method: string, key: string, body: Buffer = Buffer.alloc(0)): Promise<Response> {
  if (switchedDown) throw new StorageUnavailable("storage switched down");
  const { url, host, path } = target(key);
  const moment = new Date();
  const amzDate = moment.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join("");
  const canonical = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey: Buffer | string = `AWS4${config.s3.secretAccessKey}`;
  for (const part of [day, config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  try {
    return await fetch(url, {
      method,
      headers,
      body: method === "PUT" ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new StorageUnavailable("storage unreachable");
  }
}

function expectOk(response: Response): void {
  if (!response.ok) throw new StorageUnavailable(`storage answered ${response.status}`);
}

export async function putObject(key: string, body: Buffer): Promise<void> {
  const response = await send("PUT", key, body);
  expectOk(response);
  await response.arrayBuffer();
}

/** The byte size the store reports for an object, or null when it has none. */
export async function objectSize(key: string): Promise<number | null> {
  const response = await send("HEAD", key);
  if (response.status === 404) return null;
  expectOk(response);
  return Number(response.headers.get("content-length"));
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send("GET", key);
  expectOk(response);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send("DELETE", key);
  if (response.status !== 404) expectOk(response);
  await response.arrayBuffer();
}

export async function storageAnswers(): Promise<boolean> {
  try {
    const response = await send("HEAD", "");
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}

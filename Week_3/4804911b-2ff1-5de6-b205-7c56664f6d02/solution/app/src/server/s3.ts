import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { FRESH_CONNECTION, providers } from "./status.js";

// Hand-written SigV4: presigning is pure computation, so a signed link never implies the object is reachable.
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const encode = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (path: string): string => path.split("/").map(encode).join("/");

function stamp(): { amzDate: string; day: string } {
  const iso = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate: iso, day: iso.slice(0, 8) };
}

function signingKey(day: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${config.s3SecretAccessKey}`, day), config.s3Region), "s3"), "aws4_request");
}

function target(base: string, key: string): { url: URL; path: string } {
  const root = new URL(base);
  const path = `/${config.s3Bucket}${key ? `/${key}` : ""}`;
  return { url: new URL(`${root.origin}${encodePath(path)}`), path };
}

/** A 60-second GET link for `key`, signed for MINIO_PUBLIC_URL. */
export function presign(key: string, extra: Record<string, string> = {}): string {
  const { url } = target(config.minioPublicUrl, key);
  const { amzDate, day } = stamp();
  const scope = `${day}/${config.s3Region}/s3/aws4_request`;
  const query: Record<string, string> = {
    ...extra,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.s3AccessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": "60",
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query).sort().map((k) => `${encode(k)}=${encode(query[k]!)}`).join("&");
  const canonical = ["GET", url.pathname, canonicalQuery, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
  return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

interface Answer { status: number; body: Buffer }

async function request(method: string, key: string, body?: Buffer, headers: Record<string, string> = {}, timeoutMs = 3500): Promise<Answer> {
  const { url } = target(config.s3Endpoint, key);
  const { amzDate, day } = stamp();
  const payloadHash = sha256(body ?? "");
  const signed: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(signed).sort();
  const canonical = [method, url.pathname, "", names.map((n) => `${n}:${signed[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3Region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  try {
    const answer = await fetch(url, {
      method,
      body: body ? new Uint8Array(body) : undefined,
      headers: { ...FRESH_CONNECTION, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, authorization, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const bytes = Buffer.from(await answer.arrayBuffer());
    providers.storage = answer.status < 500;
    return { status: answer.status, body: bytes };
  } catch (error) {
    providers.storage = false;
    throw error;
  }
}

export const sheetKey = (copyId: string, sha: string): string => `${copyId}/sheets/${sha}`;
export const pdfKey = (copyId: string, number: string, version: number): string => `${copyId}/notices/${number}/v${version}.pdf`;

async function readObject(key: string): Promise<Buffer | null> {
  const answer = await request("GET", key);
  if (answer.status === 404) return null;
  if (answer.status !== 200) throw new Error(`storage answered ${answer.status}`);
  return answer.body;
}

/** Stores bytes under a key once. An object that already exists is never rewritten; its bytes are returned instead. */
export async function storeOnce(key: string, bytes: Buffer, contentType: string): Promise<Buffer> {
  const existing = await readObject(key);
  if (existing) return existing;
  const put = await request("PUT", key, bytes, { "content-type": contentType, "if-none-match": "*" }, 8000);
  if (put.status === 412) return (await readObject(key)) ?? bytes;
  if (put.status !== 200) throw new Error(`storage answered ${put.status}`);
  return bytes;
}

export async function touchBucket(): Promise<void> {
  const head = await request("HEAD", "", undefined, {}, 3000);
  if (head.status === 404) {
    const made = await request("PUT", "", undefined, {}, 3000);
    if (made.status >= 300) throw new Error(`bucket answered ${made.status}`);
    return;
  }
  if (head.status >= 500) throw new Error(`storage answered ${head.status}`);
}

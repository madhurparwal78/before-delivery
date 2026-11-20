import { createHash, createHmac } from "node:crypto";
import { config } from "./config";
import { wallClock } from "./clock";

const REQUEST_TIMEOUT_MS = 4000;

export class StorageUnavailable extends Error {}

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function encodePath(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

interface Signed {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, objectPath: string, query: string, body: Buffer, contentType?: string): Signed {
  const base = new URL(config.s3.endpoint);
  const pathStyle = config.s3.forcePathStyle;
  const host = pathStyle ? base.host : `${config.s3.bucket}.${base.host}`;
  const canonicalPath = encodePath(pathStyle ? `/${config.s3.bucket}${objectPath}` : objectPath || "/");
  const stamp = wallClock().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonical = [method, canonicalPath, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${base.protocol}//${host}${canonicalPath}${query ? `?${query}` : ""}`, headers };
}

async function send(method: string, objectPath: string, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<Response> {
  const signed = sign(method, objectPath, "", body, contentType);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === "PUT" ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new StorageUnavailable("object storage is unreachable");
  }
}

/** Store an object and confirm MinIO holds it at the uploaded size before reporting success. */
export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  const put = await send("PUT", `/${key}`, data, contentType);
  if (!put.ok) throw new StorageUnavailable(`object storage refused the write (${put.status})`);
  const head = await send("HEAD", `/${key}`);
  if (!head.ok || Number(head.headers.get("content-length")) !== data.length) {
    throw new StorageUnavailable("object storage did not confirm the object");
  }
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send("GET", `/${key}`);
  if (!response.ok) throw new StorageUnavailable(`object storage could not read the object (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export async function storageReachable(): Promise<boolean> {
  try {
    const response = await send("HEAD", "");
    return response.ok;
  } catch {
    return false;
  }
}

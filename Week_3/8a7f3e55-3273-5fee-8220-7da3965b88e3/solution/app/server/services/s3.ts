import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";

const TIMEOUT_MS = 10_000;

export class StorageUnavailable extends Error {}

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

function target(key: string): { url: URL; canonicalPath: string } {
  const endpoint = new URL(config.s3.endpoint);
  const keyPath = key.split("/").map(encodeSegment).join("/");
  if (config.s3.forcePathStyle) {
    const path = `${endpoint.pathname.replace(/\/$/, "")}/${encodeSegment(config.s3.bucket)}/${keyPath}`;
    return { url: new URL(path, endpoint), canonicalPath: path };
  }
  endpoint.hostname = `${config.s3.bucket}.${endpoint.hostname}`;
  const path = `${endpoint.pathname.replace(/\/$/, "")}/${keyPath}`;
  return { url: new URL(path, endpoint), canonicalPath: path };
}

async function signedRequest(method: "PUT" | "GET" | "DELETE", key: string, body: Buffer, contentType?: string): Promise<Response> {
  const { url, canonicalPath } = target(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [method, canonicalPath, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers["authorization"] =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  delete headers["host"];
  // The timeout covers connecting and the first bytes of the answer; a body that is streaming is cut only by its reader.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { method, headers, body: method === "PUT" ? new Uint8Array(body) : undefined, signal: controller.signal });
  } catch {
    throw new StorageUnavailable("storage cannot be reached");
  } finally {
    clearTimeout(timer);
  }
}

/** Frees the storage connection of an answer whose body nobody needs. */
const discard = (response: Response): Promise<void> => response.body?.cancel() ?? Promise.resolve();

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await signedRequest("PUT", key, body, contentType);
  await discard(response);
  if (!response.ok) throw new StorageUnavailable(`PUT answered ${response.status}`);
}

/** The stored bytes as a stream: cancelling it closes the storage connection at once. */
export async function getObjectStream(key: string): Promise<ReadableStream<Uint8Array>> {
  const response = await signedRequest("GET", key, Buffer.alloc(0));
  if (!response.ok || response.body === null) {
    await discard(response);
    throw new StorageUnavailable(`GET answered ${response.status}`);
  }
  return response.body;
}

export async function deleteObject(key: string): Promise<void> {
  const response = await signedRequest("DELETE", key, Buffer.alloc(0));
  await discard(response);
  if (!response.ok && response.status !== 404) throw new StorageUnavailable(`DELETE answered ${response.status}`);
}

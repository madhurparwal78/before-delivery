import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";
import { errors } from "../errors.js";

const SERVICE = "s3";

function sha256Hex(payload: Buffer | string): string {
  return createHash("sha256").update(payload).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, objectKey: string | null, payload: Buffer): SignedRequest {
  const endpoint = new URL(config.storage.endpoint);
  const path = objectKey === null
    ? `/${config.storage.bucket}`
    : `/${config.storage.bucket}/${objectKey.split("/").map(encodeSegment).join("/")}`;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = {
    host: endpoint.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${config.storage.region}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.storage.secretAccessKey}`, dateStamp), config.storage.region), SERVICE),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  headers.Authorization =
    `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${endpoint.origin}${path}`, headers };
}

async function send(
  method: string,
  objectKey: string | null,
  payload: Buffer,
  timeoutMs = 20_000,
): Promise<Response> {
  const signed = sign(method, objectKey, payload);
  let response: Response;
  try {
    response = await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === "PUT" || method === "POST" ? payload : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw errors.storageUnavailable();
  }
  if (response.status >= 500) {
    await response.text().catch(() => "");
    throw errors.storageUnavailable();
  }
  return response;
}

export async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(`${new URL(config.storage.endpoint).origin}/minio/health/live`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await send("HEAD", null, Buffer.alloc(0));
  if (head.ok) return;
  const created = await send("PUT", null, Buffer.alloc(0));
  if (!created.ok && created.status !== 409) {
    throw new Error(`could not create the storage bucket: ${created.status}`);
  }
}

export async function putObject(objectKey: string, body: Buffer): Promise<void> {
  const response = await send("PUT", objectKey, body);
  if (!response.ok) throw new Error(`storage refused ${objectKey}: ${response.status}`);
}

export async function getObject(objectKey: string): Promise<Buffer | null> {
  const response = await send("GET", objectKey, Buffer.alloc(0));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`storage refused ${objectKey}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function objectExists(objectKey: string): Promise<boolean> {
  const response = await send("HEAD", objectKey, Buffer.alloc(0));
  return response.ok;
}

export async function deleteObject(objectKey: string): Promise<void> {
  await send("DELETE", objectKey, Buffer.alloc(0));
}

export function portalFolderMarkerKey(orderId: string): string {
  return `portal/${orderId}/.portal`;
}

export function fileObjectKey(
  orderId: string,
  kind: "asset" | "deliverable",
  fileId: string,
  fileName: string,
): string {
  const folder = kind === "asset" ? "assets" : "deliverables";
  return `portal/${orderId}/${folder}/${fileId}/${fileName}`;
}

export function invoicePdfKey(orderId: string, invoiceId: string): string {
  return `portal/${orderId}/invoices/${invoiceId}.pdf`;
}

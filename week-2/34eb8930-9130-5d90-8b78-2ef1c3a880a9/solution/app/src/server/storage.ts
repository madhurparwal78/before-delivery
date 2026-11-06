import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

/** One proposal body object in the provided bucket (Services, Object storage). */
const TIMEOUT_MS = 5000;

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function target(key: string): URL {
  const { endpoint, bucket, forcePathStyle } = config.s3;
  const base = new URL(endpoint);
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (forcePathStyle) return new URL(`${base.pathname.replace(/\/$/, "")}/${encodeURIComponent(bucket)}/${path}`, base);
  base.hostname = `${bucket}.${base.hostname}`;
  return new URL(`/${path}`, base);
}

async function send(method: "GET" | "PUT" | "DELETE", key: string, body?: string): Promise<Response> {
  const url = target(key);
  const payload = body ?? "";
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = now.slice(0, 8);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": sha256(payload),
    "x-amz-date": now,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), headers["x-amz-content-sha256"]].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${now}\n${scope}\n${sha256(canonical)}`;
  let signingKey: Buffer = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  const { host: _host, ...sent } = headers;
  return fetch(url, { method, headers: sent, body: body === undefined ? undefined : payload, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

export class StorageError extends Error {}

export const objectKey = (proposalId: string): string => `documents/${proposalId}.json`;

export async function putObject(key: string, body: string): Promise<void> {
  const res = await send("PUT", key, body).catch((e: unknown) => { throw new StorageError(String(e)); });
  await res.arrayBuffer();
  if (!res.ok) throw new StorageError(`PUT ${res.status}`);
}

/** The object's text, or null when it does not exist. */
export async function getObject(key: string): Promise<string | null> {
  const res = await send("GET", key).catch((e: unknown) => { throw new StorageError(String(e)); });
  if (res.status === 404) { await res.arrayBuffer(); return null; }
  if (!res.ok) { await res.arrayBuffer(); throw new StorageError(`GET ${res.status}`); }
  return res.text();
}

export async function deleteObject(key: string): Promise<void> {
  const res = await send("DELETE", key).catch((e: unknown) => { throw new StorageError(String(e)); });
  await res.arrayBuffer();
  if (!res.ok && res.status !== 404) throw new StorageError(`DELETE ${res.status}`);
}

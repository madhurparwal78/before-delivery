// MinIO / S3 over Signature Version 4: put, delete, bucket check and short-lived signed GET links.
// The bucket stays private; browsers only ever receive the signed links.

import { createHash, createHmac } from "node:crypto";
import { config } from "../config";
import { serviceRequest, type ServiceAnswer } from "./serviceHttp";

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.storage;
const base = new URL(endpoint);
const SIGNED_LINK_SECONDS = 300;
const TIMEOUT_MS = 10_000;

export class StorageUnavailable extends Error {}

const hex = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function target(key: string): { host: string; path: string; origin: string } {
  const objectPath = key ? `/${key.split("/").map(encodeSegment).join("/")}` : "/";
  if (forcePathStyle) {
    return { host: base.host, path: `${base.pathname.replace(/\/$/, "")}/${bucket}${key ? objectPath : ""}`, origin: base.origin };
  }
  const host = `${bucket}.${base.host}`;
  return { host, path: objectPath, origin: `${base.protocol}//${host}` };
}

function stamp(now: Date): { amzDate: string; day: string } {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, day: amzDate.slice(0, 8) };
}

function signature(day: string, toSign: string): string {
  let key: Buffer = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) key = hmac(key, part);
  return createHmac("sha256", key).update(toSign).digest("hex");
}

function canonicalQuery(query: Record<string, string>): string {
  return Object.keys(query).sort().map((k) => `${encodeSegment(k)}=${encodeSegment(query[k])}`).join("&");
}

async function request(method: string, key: string, body?: Buffer, contentType?: string): Promise<ServiceAnswer> {
  const { host, path, origin } = target(key);
  const { amzDate, day } = stamp(new Date());
  const payloadHash = hex(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(canonical)].join("\n");
  try {
    return await serviceRequest(`${origin}${path}`, method, {
      ...headers,
      "content-length": String(body?.length ?? 0),
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature(day, toSign)}`,
    }, body, TIMEOUT_MS);
  } catch {
    throw new StorageUnavailable("object storage did not answer");
  }
}

const ok = (answer: ServiceAnswer): boolean => answer.status >= 200 && answer.status < 300;

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const answer = await request("PUT", key, body, contentType);
  if (!ok(answer)) throw new StorageUnavailable(`object storage refused the write (${answer.status})`);
}

export async function deleteObject(key: string): Promise<void> {
  const answer = await request("DELETE", key);
  if (!ok(answer) && answer.status !== 404) throw new StorageUnavailable(`object storage refused the delete (${answer.status})`);
}

/** True when the bucket answers; a missing bucket is created private. */
export async function checkBucket(): Promise<boolean> {
  try {
    const head = await request("HEAD", "");
    if (head.status === 404) return ok(await request("PUT", ""));
    return ok(head);
  } catch {
    return false;
  }
}

/** A GET link for one object that expires SIGNED_LINK_SECONDS after it is issued. */
export function signedLink(key: string, now = new Date()): string {
  const { host, path, origin } = target(key);
  const { amzDate, day } = stamp(now);
  const scope = `${day}/${region}/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(SIGNED_LINK_SECONDS),
    "X-Amz-SignedHeaders": "host",
  };
  const canonical = ["GET", path, canonicalQuery(query), `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(canonical)].join("\n");
  return `${origin}${path}?${canonicalQuery(query)}&X-Amz-Signature=${signature(day, toSign)}`;
}

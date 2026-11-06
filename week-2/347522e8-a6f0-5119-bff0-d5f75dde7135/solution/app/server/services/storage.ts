// Private objects in the S3 bucket (MinIO), signed with AWS Signature V4. Files leave only
// through presigned GET links that expire 60 seconds after they are issued.

import { createHash, createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { config } from "../config.js";
import { now } from "../clock.js";

const STORAGE_TIMEOUT_MS = 5000;
const SIGNED_LINK_SECONDS = 60;

export class StorageUnavailable extends Error {}

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

interface Target {
  url: URL;
  host: string;
  canonicalPath: string;
}

function target(key: string): Target {
  const endpoint = new URL(config.s3.endpoint);
  const encodedKey = key.split("/").map(encodeSegment).join("/");
  const canonicalPath = config.s3.forcePathStyle ? `/${encodeSegment(config.s3.bucket)}/${encodedKey}` : `/${encodedKey}`;
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  return { url: new URL(`${endpoint.protocol}//${host}${canonicalPath}`), host, canonicalPath };
}

function stamps(): { amzDate: string; day: string } {
  const amzDate = new Date(now()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, day: amzDate.slice(0, 8) };
}

function signature(day: string, stringToSign: string): string {
  let key = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) key = hmac(key, part);
  return createHmac("sha256", key).update(stringToSign).digest("hex");
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((name) => `${encodeSegment(name)}=${encodeSegment(params[name] ?? "")}`)
    .join("&");
}

function signedRequest(method: "PUT" | "HEAD", key: string, body: Buffer, contentType?: string): Promise<number> {
  const { url, host, canonicalPath } = target(key);
  const { amzDate, day } = stamps();
  const payloadHash = sha256(body);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonical = [method, canonicalPath, "", `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const headers: Record<string, string> = {
    Host: host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature(day, stringToSign)}`,
    "Content-Length": String(body.length),
  };
  if (contentType) headers["Content-Type"] = contentType;
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = send(url, { method, headers, agent: false, timeout: STORAGE_TIMEOUT_MS }, (incoming) => {
      incoming.resume();
      incoming.on("end", () => resolve(incoming.statusCode ?? 0));
    });
    outgoing.on("timeout", () => outgoing.destroy(new StorageUnavailable("storage timed out")));
    outgoing.on("error", (error) => reject(error instanceof StorageUnavailable ? error : new StorageUnavailable(error.message)));
    outgoing.end(body);
  });
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const status = await signedRequest("PUT", key, body, contentType);
  if (status !== 200) throw new StorageUnavailable(`storage answered ${status}`);
}

/** Checks the object is reachable, then issues a presigned GET that expires in 60 seconds. */
export async function signedLink(key: string): Promise<string> {
  const status = await signedRequest("HEAD", key, Buffer.alloc(0));
  if (status !== 200) throw new StorageUnavailable(`storage answered ${status}`);
  const { url, host, canonicalPath } = target(key);
  const { amzDate, day } = stamps();
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const query = canonicalQuery({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.s3.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(SIGNED_LINK_SECONDS),
    "X-Amz-SignedHeaders": "host",
  });
  const canonical = ["GET", canonicalPath, query, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  return `${url.origin}${canonicalPath}?${query}&X-Amz-Signature=${signature(day, stringToSign)}`;
}

// Private document objects in MinIO (S3 API, SigV4). Each call opens a fresh connection, so the
// first request after storage returns succeeds without a restart.

import { createHash, createHmac } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { config } from "./config.js";

const TIMEOUT_MS = 15_000;

export class StorageUnavailable extends Error {}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function request(method: "PUT" | "GET" | "DELETE", key: string, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<Buffer> {
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.storage;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = `${forcePathStyle ? `/${encodeSegment(bucket)}` : ""}/${key.split("/").map(encodeSegment).join("/")}`;
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = now.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": now };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", ...names.map((n) => `${n}:${headers[n]}`), "", names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${hmac(signingKey, toSign).toString("hex")}`;
  headers["content-length"] = String(body.length);
  const transport = base.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const outgoing = transport.request({ method, host: base.hostname, port: base.port || undefined, path, headers, agent: false, timeout: TIMEOUT_MS }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("error", (error) => reject(new StorageUnavailable(String(error))));
      incoming.on("end", () => {
        const status = incoming.statusCode ?? 0;
        if (status >= 200 && status < 300) resolve(Buffer.concat(chunks));
        else reject(new StorageUnavailable(`storage ${method} answered ${status}`));
      });
    });
    outgoing.on("timeout", () => outgoing.destroy(new Error("storage timed out")));
    outgoing.on("error", (error) => reject(new StorageUnavailable(String(error))));
    outgoing.end(body);
  });
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await request("PUT", key, bytes, contentType);
}

export function getObject(key: string): Promise<Buffer> {
  return request("GET", key);
}

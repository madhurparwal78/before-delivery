// MinIO over the S3 API, signed with AWS Signature Version 4 (brief: Services > MinIO).
import { createHash, createHmac } from "node:crypto";
import type { Config } from "../config.js";
import { ProviderUnavailable } from "./errors.js";

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function createObjectStore(config: Config["s3"]) {
  const endpoint = new URL(config.endpoint);

  function target(key: string): { url: string; host: string; path: string } {
    const encodedKey = key.split("/").map(encodeSegment).join("/");
    if (config.forcePathStyle) {
      const path = `${endpoint.pathname.replace(/\/$/, "")}/${encodeSegment(config.bucket)}/${encodedKey}`;
      return { url: `${endpoint.origin}${path}`, host: endpoint.host, path };
    }
    const host = `${config.bucket}.${endpoint.host}`;
    return { url: `${endpoint.protocol}//${host}/${encodedKey}`, host, path: `/${encodedKey}` };
  }

  async function signed(method: "GET" | "PUT", key: string, body: Buffer, contentType?: string): Promise<Response> {
    const { url, host, path } = target(key);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = stamp.slice(0, 8);
    const payloadHash = sha256(body);
    const headers: Record<string, string> = {
      ...(contentType ? { "content-type": contentType } : {}),
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": stamp,
    };
    const names = Object.keys(headers).sort();
    const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
    const scope = `${day}/${config.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
    let signingKey = hmac(`AWS4${config.secretAccessKey}`, day);
    for (const part of [config.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
    const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
    const { host: _host, ...sent } = headers;
    try {
      return await fetch(url, {
        method,
        headers: { ...sent, authorization },
        body: method === "PUT" ? body : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new ProviderUnavailable(`MinIO ${method} ${key}: ${String(error)}`);
    }
  }

  return {
    /** Stores the object and returns its ETag. */
    async put(key: string, body: Buffer, contentType: string): Promise<string> {
      const response = await signed("PUT", key, body, contentType);
      if (!response.ok) throw new ProviderUnavailable(`MinIO PUT ${key}: ${response.status} ${await response.text()}`);
      return response.headers.get("etag") ?? "";
    },

    async get(key: string): Promise<{ body: Buffer; etag: string }> {
      const response = await signed("GET", key, Buffer.alloc(0));
      if (!response.ok) throw new ProviderUnavailable(`MinIO GET ${key}: ${response.status}`);
      return { body: Buffer.from(await response.arrayBuffer()), etag: response.headers.get("etag") ?? "" };
    },
  };
}

export type ObjectStore = ReturnType<typeof createObjectStore>;

import { createHash, createHmac } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { request as httpRequest, type RequestOptions } from "node:http";
import type { Config } from "./config.js";

export class StorageUnavailable extends Error {}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

// Minimal S3 REST client with AWS SigV4 signing over path-style URLs.
export class S3 {
  constructor(private cfg: Config) {}

  private objectUrl(key: string): { url: URL; host: string } {
    const base = this.cfg.s3.endpoint;
    const path = `/${this.cfg.s3.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
    const url = new URL(base + path);
    return { url, host: url.host };
  }

  private signingKey(dateStamp: string): Buffer {
    const kDate = createHmac("sha256", `AWS4${this.cfg.s3.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac("sha256", kDate).update(this.cfg.s3.region).digest();
    const kService = createHmac("sha256", kRegion).update("s3").digest();
    return createHmac("sha256", kService).update("aws4_request").digest();
  }

  private signRequest(
    method: string,
    url: URL,
    payload: Buffer,
    extraHeaders: Record<string, string>,
  ): { options: RequestOptions; } {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256").update(payload).digest("hex");
    const rawHeaders: Record<string, string> = {
      host: url.host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      ...extraHeaders,
    };
    // Canonical headers use lowercase names.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
      headers[k.toLowerCase()] = String(v).trim();
    }
    const sortedKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedKeys.map((k) => `${k}:${String(headers[k]).trim()}\n`).join("");
    const signedHeaders = sortedKeys.join(";");
    const canonicalRequest = [
      method,
      url.pathname,
      url.search.replace(/^\?/, ""),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/${this.cfg.s3.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");
    const signature = createHmac("sha256", this.signingKey(dateStamp)).update(stringToSign).digest("hex");
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.cfg.s3.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const headersOut: Record<string, string> = {
      ...headers,
      Authorization: authorization,
    };
    delete headersOut.host;
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const options: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { ...headersOut, Host: url.host, "Content-Length": String(payload.length) },
    };
    return { options };
  }

  private async request(
    method: string,
    key: string,
    payload: Buffer,
    extraHeaders: Record<string, string>,
  ): Promise<{ status: number; body: Buffer; contentType: string | undefined }> {
    const { url } = this.objectUrl(key);
    const { options } = this.signRequest(method, url, payload, extraHeaders);
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = send(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks),
            contentType: res.headers["content-type"],
          }),
        );
      });
      req.setTimeout(6000, () => req.destroy(new StorageUnavailable("s3 timeout")));
      req.on("error", (e) => reject(new StorageUnavailable(e.message)));
      req.write(payload);
      req.end();
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.request("PUT", key, body, { "Content-Type": contentType });
    if (res.status !== 200) throw new StorageUnavailable(`put failed: ${res.status}`);
  }

  async get(key: string): Promise<StoredObject> {
    const res = await this.request("GET", key, Buffer.alloc(0), {});
    if (res.status !== 200) throw new StorageUnavailable(`get failed: ${res.status}`);
    return {
      body: res.body,
      contentType: res.contentType ?? "application/octet-stream",
    };
  }

  async head(key: string): Promise<boolean> {
    const res = await this.request("HEAD", key, Buffer.alloc(0), {});
    return res.status === 200;
  }

  async remove(key: string): Promise<void> {
    const res = await this.request("DELETE", key, Buffer.alloc(0), {});
    if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
      throw new StorageUnavailable(`delete failed: ${res.status}`);
    }
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.request("HEAD", "", Buffer.alloc(0), {});
      return res.status > 0;
    } catch {
      return false;
    }
  }
}

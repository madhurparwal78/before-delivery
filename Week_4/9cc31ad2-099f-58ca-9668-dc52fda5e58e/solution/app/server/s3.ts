import { createHash, createHmac } from "node:crypto";
import http from "node:http";
import https from "node:https";
import type { Config } from "./config.js";

export class StorageUnavailable extends Error {}

interface S3Response {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const encodeKey = (key: string) => key.split("/").map((part) => encodeURIComponent(part)).join("/");

// A small SigV4 client for the three calls Kerbline makes: put, get and the bucket probe.
export class ReplayStore {
  constructor(private readonly config: Config["s3"]) {}

  private target(key: string): URL {
    const base = new URL(this.config.endpoint);
    if (this.config.forcePathStyle) {
      base.pathname = `/${this.config.bucket}${key ? `/${encodeKey(key)}` : ""}`;
    } else {
      base.hostname = `${this.config.bucket}.${base.hostname}`;
      base.pathname = key ? `/${encodeKey(key)}` : "/";
    }
    return base;
  }

  private request(method: string, key: string, timeoutMs: number, body: Buffer = Buffer.alloc(0),
    extra: Record<string, string> = {}): Promise<S3Response> {
    const url = this.target(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = amzDate.slice(0, 8);
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": sha256(body),
      "x-amz-date": amzDate,
      ...extra,
    };
    const names = Object.keys(headers).map((name) => name.toLowerCase()).sort();
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
    const canonical = [method, url.pathname, "", names.map((name) => `${name}:${lower[name]}\n`).join(""),
      names.join(";"), headers["x-amz-content-sha256"]].join("\n");
    const scope = `${day}/${this.config.region}/s3/aws4_request`;
    const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
    let signingKey = hmac(`AWS4${this.config.secretAccessKey}`, day);
    for (const part of [this.config.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
    const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
    headers.Authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
    headers["Content-Length"] = String(body.length);

    const transport = url.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const req = transport.request(url, { method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", (error) => reject(new StorageUnavailable(error.message)));
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error("timed out")));
      req.on("error", (error) => reject(new StorageUnavailable(error.message)));
      req.end(body);
    });
  }

  async put(key: string, body: Buffer, digest: string, timeoutMs: number): Promise<void> {
    const res = await this.request("PUT", key, timeoutMs, body, {
      "content-type": "application/json",
      "x-amz-meta-sha256": digest,
    });
    if (res.status !== 200) throw new StorageUnavailable(`put answered ${res.status}`);
  }

  // The stored bytes, or null when no object exists.
  async get(key: string): Promise<Buffer | null> {
    const res = await this.request("GET", key, 5000);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new StorageUnavailable(`get answered ${res.status}`);
    return res.body;
  }

  async available(): Promise<boolean> {
    try {
      const res = await this.request("HEAD", "", 1500);
      return res.status === 200;
    } catch {
      return false;
    }
  }

  // An empty bucket of the configured name is created when the provider has none yet.
  async ensureBucket(): Promise<void> {
    try {
      const res = await this.request("HEAD", "", 3000);
      if (res.status === 404) await this.request("PUT", "", 3000);
    } catch {
      // Storage unreachable at boot: the server serves its outage behaviour.
    }
  }
}

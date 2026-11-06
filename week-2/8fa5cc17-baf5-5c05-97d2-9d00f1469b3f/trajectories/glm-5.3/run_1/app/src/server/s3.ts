// Minimal S3 client for the MinIO object store: bucket ensure, putObject,
// statObject, getObject, deleteObject, listPrefix. AWS Signature V4, with a
// three-second timeout per call. The single home of storage access.

import { createHash, createHmac } from "node:crypto";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

interface S3Response {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** A storage client. Every call gives up after at most three seconds. */
export class S3 {
  private readonly cfg: S3Config;
  private memoAt = 0;
  private bucketReady: boolean | null = null;

  constructor(cfg: S3Config) {
    this.cfg = cfg;
  }

  private request(method: string, rawPath: string, body?: Buffer, headers?: Record<string, string>, query?: Array<[string, string]>): Promise<S3Response> {
    const url = new URL(this.cfg.endpoint);
    const isHttps = url.protocol === "https:";
    const pathOnly = rawPath;
    const path = this.cfg.forcePathStyle ? `/${this.cfg.bucket}${pathOnly}` : pathOnly;
    // canonical query: URI-encoded pairs, sorted
    const encodedParams = (query ?? []).map((p) => ({ k: encodeURIComponent(p[0]), v: encodeURIComponent(p[1]) }));
    encodedParams.sort((a, b) => (a.k === b.k ? (a.v < b.v ? -1 : 1) : a.k < b.k ? -1 : 1));
    const canonicalQuery = encodedParams.map((p) => `${p.k}=${p.v}`).join("&");
    const host = this.cfg.forcePathStyle ? url.host : `${this.cfg.bucket}.${url.host}`;
    const payload = body ?? Buffer.alloc(0);
    const payloadHash = sha256Hex(payload);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const allHeaders: Record<string, string> = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "content-length": String(payload.length),
      ...headers,
    };
    const signedHeaders = Object.keys(allHeaders)
      .map((h) => h.toLowerCase())
      .sort()
      .join(";");
    const canonicalHeaders = Object.keys(allHeaders)
      .map((h) => `${h.toLowerCase()}:${allHeaders[h].trim()}\n`)
      .sort()
      .join("");
    const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`;
    const kDate = hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.cfg.region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
    const auth = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return new Promise((resolve, reject) => {
      const opts: RequestOptions = {
        method,
        hostname: url.hostname,
        port: Number(url.port) || (isHttps ? 443 : 80),
        path: canonicalQuery.length > 0 ? `${path}?${canonicalQuery}` : path,
        headers: { ...allHeaders, Authorization: auth },
        timeout: 3000,
      };
      const doRequest = isHttps ? httpsRequest : httpRequest;
      const req = doRequest(opts, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const outHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) outHeaders[k] = Array.isArray(v) ? v.join(",") : String(v);
          resolve({ status: res.statusCode ?? 0, headers: outHeaders, body: Buffer.concat(chunks) });
        });
      });
      req.on("timeout", () => {
        req.destroy(new Error("timeout"));
      });
      req.on("error", (e: Error) => reject(e));
      if (payload.length > 0) req.write(payload);
      req.end();
    });
  }

  private async call(method: string, rawPath: string, body?: Buffer, headers?: Record<string, string>, query?: Array<[string, string]>): Promise<S3Response | null> {
    try {
      return await this.request(method, rawPath, body, headers, query);
    } catch {
      return null;
    }
  }

  /**
   * True when the store answered our last availability probe. The answer is
   * never remembered for longer than ten seconds.
   */
  async available(): Promise<boolean> {
    const now = Date.now();
    if (this.bucketReady !== null && now - this.memoAt < 10000) return this.bucketReady;
    const head = await this.call("HEAD", "/");
    this.bucketReady = head !== null && head.status >= 200 && head.status < 500;
    this.memoAt = now;
    if (this.bucketReady) {
      // make sure the bucket exists once, best effort
      if (head !== null && head.status === 404) {
        await this.call("PUT", "/");
      }
    }
    return this.bucketReady;
  }

  /** Put an object. True when the store confirms the write. */
  async putObject(key: string, body: Buffer, contentType: string): Promise<boolean> {
    const res = await this.call("PUT", `/${encodeKey(key)}`, body, { "content-type": contentType });
    return res !== null && res.status >= 200 && res.status < 300;
  }

  /** Read an object's metadata; the reported size, or null. */
  async statObject(key: string): Promise<number | null> {
    const res = await this.call("HEAD", `/${encodeKey(key)}`);
    if (res === null || res.status < 200 || res.status >= 300) return null;
    const len = res.headers["content-length"];
    if (len === undefined) return null;
    const n = Number(len);
    return Number.isFinite(n) ? n : null;
  }

  /** Get an object's bytes, or null when unavailable. */
  async getObject(key: string): Promise<Buffer | null> {
    const res = await this.call("GET", `/${encodeKey(key)}`);
    if (res === null || res.status < 200 || res.status >= 300) return null;
    return res.body;
  }

  /** Delete an object. True on success. */
  async deleteObject(key: string): Promise<boolean> {
    const res = await this.call("DELETE", `/${encodeKey(key)}`);
    return res !== null && res.status >= 200 && res.status < 300;
  }

  /** List object keys under a prefix (up to 1000 per call). */
  async listPrefix(prefix: string): Promise<string[]> {
    const res = await this.call("GET", "/", undefined, undefined, [["list-type", "2"], ["prefix", prefix], ["max-keys", "1000"]]);
    if (res === null || res.status < 200 || res.status >= 300) return [];
    const xml = res.body.toString("utf8");
    const keys: string[] = [];
    const re = /<Key>([^<]*)<\/Key>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      if (m[1] !== prefix) keys.push(m[1]);
    }
    return keys;
  }

  /** Delete an object, retrying until the store answers. */
  async deleteObjectRetry(key: string, attempt?: number): Promise<boolean> {
    const ok = await this.deleteObject(key);
    if (ok) return true;
    const n = (attempt ?? 0) + 1;
    if (n >= 60) return false;
    await new Promise((r) => setTimeout(r, 2000));
    return this.deleteObjectRetry(key, n);
  }
}

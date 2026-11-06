import { createHash, createHmac } from "node:crypto";
import type { Config } from "./config.js";
import { storageUnavailable } from "./errors.js";

/**
 * A minimal S3 client speaking AWS Signature V4 to MinIO. Nothing is public;
 * browsers only ever see presigned links valid for 60 seconds.
 */
export class S3 {
  private endpoint: URL;
  private region: string;

  constructor(private cfg: Config) {
    this.endpoint = new URL(cfg.s3Endpoint);
    this.region = cfg.s3Region;
  }

  private host(): string {
    return this.endpoint.host;
  }

  private urlFor(key: string): URL {
    const base = this.endpoint;
    const path = `/${this.cfg.s3Bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
    return new URL(base.protocol + "//" + base.host + path);
  }

  private signingKey(date: string): Buffer {
    const kDate = createHmac("sha256", `AWS4${this.cfg.s3SecretAccessKey}`).update(date).digest();
    const kRegion = createHmac("sha256", kDate).update(this.region).digest();
    const kService = createHmac("sha256", kRegion).update("s3").digest();
    return createHmac("sha256", kService).update("aws4_request").digest();
  }

  private async do(method: string, key: string, body?: Buffer, contentType?: string): Promise<Response> {
    const url = this.urlFor(key);
    const payloadHash = body ? createHash("sha256").update(body).digest("hex") : createHash("sha256").update("").digest("hex");
    const headers: Record<string, string> = {};
    if (contentType) headers["content-type"] = contentType;
    if (body) headers["content-length"] = String(body.length);
    const signed = await this.signedHeaders(method, url, headers, payloadHash);
    try {
      return await fetch(url, {
        method,
        headers: signed,
        body: body ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw storageUnavailable();
    }
  }

  /** The full header set for a signed request, including the Authorization line. */
  private async signedHeaders(
    method: string,
    url: URL,
    headers: Record<string, string>,
    payloadHash: string,
    extraQuery: Record<string, string> = {}
  ): Promise<Record<string, string>> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const allHeaders: Record<string, string> = {
      host: this.host(),
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...headers,
    };
    const sortedKeys = Object.keys(allHeaders).sort();
    const canonicalHeaders = sortedKeys.map((k) => `${k}:${allHeaders[k]!.trim()}\n`).join("");
    const signedHeaders = sortedKeys.join(";");
    const canonicalQuery = Object.keys(extraQuery)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(extraQuery[k]!)}`)
      .join("&");
    const canonicalRequest = [method, url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${date}/${this.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
    const signature = createHmac("sha256", this.signingKey(date)).update(stringToSign).digest("hex");
    const out: Record<string, string> = { ...allHeaders };
    delete out.host;
    out.Authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return out;
  }

  async ensureBucket(): Promise<void> {
    const url = new URL(this.endpoint.protocol + "//" + this.endpoint.host + `/${this.cfg.s3Bucket}`);
    const payloadHash = createHash("sha256").update("").digest("hex");
    const head = await this.signedHeaders("HEAD", url, {}, payloadHash);
    let res: Response;
    try {
      res = await fetch(url, { method: "HEAD", headers: head, signal: AbortSignal.timeout(8000) });
    } catch {
      throw storageUnavailable();
    }
    if (res.status === 200) return;
    if (res.status === 404) {
      const put = await this.signedHeaders("PUT", url, {}, payloadHash);
      let putRes: Response;
      try {
        putRes = await fetch(url, { method: "PUT", headers: put, signal: AbortSignal.timeout(8000) });
      } catch {
        throw storageUnavailable();
      }
      if (putRes.status !== 200) throw storageUnavailable();
      return;
    }
    if (res.status === 403) {
      // The bucket exists but HEAD is not allowed for this key; verify with a PUT-less check.
      const put = await this.signedHeaders("PUT", url, {}, payloadHash);
      let putRes: Response;
      try {
        putRes = await fetch(url, { method: "PUT", headers: put, signal: AbortSignal.timeout(8000) });
      } catch {
        throw storageUnavailable();
      }
      if (putRes.status === 409) return; // BucketAlreadyOwnedByYou
      if (putRes.status !== 200) throw storageUnavailable();
      return;
    }
    if (res.status >= 500) throw storageUnavailable();
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.do("PUT", key, body, contentType);
    if (res.status !== 200) throw storageUnavailable();
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.do("GET", key);
    if (res.status !== 200) throw storageUnavailable();
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const res = await this.do("DELETE", key);
    if (res.status !== 204 && res.status !== 200 && res.status !== 404) throw storageUnavailable();
  }

  /** A presigned GET link valid for 60 seconds. */
  async presign(key: string, expiresSeconds = 60): Promise<string> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const scope = `${date}/${this.region}/s3/aws4_request`;
    const url = this.urlFor(key);
    const query: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.cfg.s3AccessKeyId}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresSeconds),
      "X-Amz-SignedHeaders": "host",
    };
    const canonicalQuery = Object.keys(query)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k]!)}`)
      .join("&");
    const canonicalRequest = ["GET", url.pathname, canonicalQuery, `host:${this.host()}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
    const signature = createHmac("sha256", this.signingKey(date)).update(stringToSign).digest("hex");
    return `${url}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }
}

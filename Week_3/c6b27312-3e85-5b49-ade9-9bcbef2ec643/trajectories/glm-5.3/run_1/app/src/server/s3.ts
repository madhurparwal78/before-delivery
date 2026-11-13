import { createHash, createHmac } from "node:crypto";
import { Buffer } from "node:buffer";

/** Minimal SigV4 S3 client over fetch (path-style), used for MinIO. */
export class S3Client {
  private readonly endpoint: string;
  private readonly region: string;
  private readonly bucket: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  constructor(opts: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }) {
    this.endpoint = opts.endpoint.replace(/\/$/, "");
    this.region = opts.region;
    this.bucket = opts.bucket;
    this.accessKeyId = opts.accessKeyId;
    this.secretAccessKey = opts.secretAccessKey;
  }

  private url(key: string, query?: Record<string, string>): { url: URL; path: string; query: string } {
    const u = new URL(`${this.endpoint}/${this.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`);
    if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    const path = `/${this.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
    return { url: u, path, query: u.searchParams.toString() };
  }

  private sign(method: string, path: string, query: string, headers: Record<string, string>, payload: Buffer | null): Record<string, string> {
    const body = payload ?? Buffer.alloc(0);
    const payloadHash = createHash("sha256").update(body).digest("hex");
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
    const dateStamp = amzDate.slice(0, 8);
    const allHeaders: Record<string, string> = {
      host: new URL(this.endpoint).host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...headers,
    };
    const names = Object.keys(allHeaders).sort();
    const canonicalHeaders = names.map((n) => `${n}:${allHeaders[n]!.trim()}\n`).join("");
    const signedHeaders = names.join(";");
    const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
    const kDate = createHmac("sha256", `AWS4${this.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac("sha256", kDate).update(this.region).digest();
    const kService = createHmac("sha256", kRegion).update("s3").digest();
    const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
    const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
    return { ...allHeaders, Authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
  }

  private async request(method: string, key: string, opts: { body?: Buffer; contentType?: string; query?: Record<string, string> } = {}): Promise<Response> {
    const { url, path, query } = this.url(key, opts.query);
    const headers = this.sign(method, path, query, opts.contentType ? { "content-type": opts.contentType } : {}, opts.body ?? null);
    // A short timeout keeps storage-degraded mode responsive.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 3_000);
    try {
      return await fetch(url, { method, headers, body: opts.body ?? undefined, signal: timeout.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.request("PUT", key, { body, contentType });
    if (!res.ok) throw new Error(`S3 put ${key} failed: ${res.status}`);
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.request("GET", key);
    if (res.status === 404) return Promise.reject(new S3NotFound());
    if (!res.ok) throw new Error(`S3 get ${key} failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async headObject(key: string): Promise<boolean> {
    const res = await this.request("HEAD", key);
    return res.ok;
  }

  async createBucket(): Promise<void> {
    const res = await this.request("PUT", "", {});
    if (!res.ok && res.status !== 409) throw new Error(`S3 create bucket failed: ${res.status}`);
  }
}

export class S3NotFound extends Error {
  constructor() { super("S3 object not found"); }
}

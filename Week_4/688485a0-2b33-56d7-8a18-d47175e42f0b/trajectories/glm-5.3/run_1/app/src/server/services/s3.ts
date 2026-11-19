import { createHmac, createHash } from "node:crypto";
import { request as httpRequest } from "node:http";

/**
 * A minimal S3 client with SigV4 for MinIO-compatible object storage. All
 * addresses and credentials come from the environment (DP-89).
 */

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

export class S3Client {
  private readonly url: URL;
  constructor(private readonly cfg: S3Config) {
    this.url = new URL(cfg.endpoint);
  }

  private sign(method: string, path: string, query: string, headers: Record<string, string>, payload: Buffer): Record<string, string> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(payload);
    const host = this.url.host;
    const allHeaders: Record<string, string> = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...headers,
    };
    const signedHeaders = Object.keys(allHeaders).map(h => h.toLowerCase()).sort();
    const canonicalHeaders = signedHeaders.map(h => h + ":" + allHeaders[Object.keys(allHeaders).find(k => k.toLowerCase() === h) as string].trim() + "\n").join("");
    const canonical = [method, path, query, canonicalHeaders, signedHeaders.join(";"), payloadHash].join("\n");
    const scope = `${date}/${this.cfg.region}/s3/aws4_request`;
    const sts = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonical)}`;
    const kDate = hmac("AWS4" + this.cfg.secretAccessKey, date);
    const kRegion = hmac(kDate, this.cfg.region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning).update(sts).digest("hex");
    return { ...allHeaders, Authorization: `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}` };
  }

  private call(method: string, path: string, query: string, body: Buffer, headers: Record<string, string> = {}): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: this.url.hostname,
          port: this.url.port,
          method,
          path: path + (query ? "?" + query : ""),
        },
        res => {
          const chunks: Buffer[] = [];
          res.on("data", c => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        },
      );
      req.setTimeout(5000, () => {
        req.destroy(new Error("timeout"));
      });
      req.on("error", reject);
      const signed = this.sign(method, path, query, headers, body);
      for (const [k, v] of Object.entries(signed)) req.setHeader(k, v);
      if (body.length > 0) req.setHeader("content-length", String(body.length));
      req.end(body);
    });
  }

  private bucketPath(key: string): string {
    return this.cfg.forcePathStyle ? `/${this.cfg.bucket}/${key}` : `/${key}`;
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.call("PUT", this.bucketPath(key), "", body, { "content-type": contentType });
    if (res.status !== 200) throw new Error("s3 put failed: " + res.status);
  }

  async getObject(key: string): Promise<Buffer | null> {
    const res = await this.call("GET", this.bucketPath(key), "", Buffer.alloc(0));
    if (res.status === 200) return res.body;
    if (res.status === 404) return null;
    throw new Error("s3 get failed: " + res.status);
  }

  async bucketExists(): Promise<boolean> {
    const res = await this.call("HEAD", `/${this.cfg.bucket}`, "", Buffer.alloc(0));
    return res.status === 200;
  }

  async createBucket(): Promise<void> {
    const res = await this.call("PUT", `/${this.cfg.bucket}`, "", Buffer.alloc(0));
    if (res.status !== 200 && res.status !== 409) throw new Error("s3 create bucket failed: " + res.status);
  }

  async ensureBucket(): Promise<void> {
    if (!(await this.bucketExists())) await this.createBucket();
  }
}

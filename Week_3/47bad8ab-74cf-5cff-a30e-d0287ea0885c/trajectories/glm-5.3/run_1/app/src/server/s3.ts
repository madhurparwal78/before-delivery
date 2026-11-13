import { createHash, createHmac } from "node:crypto";

/**
 * Minimal S3 client (SigV4) for put/get/head of small objects. The app only ever
 * stores puzzle originals and solve records, so streaming and multipart are unnecessary.
 */
export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export class S3 {
  private readonly endpoint: URL;
  constructor(private readonly cfg: S3Config) {
    this.endpoint = new URL(cfg.endpoint);
  }

  private host(): string {
    return this.endpoint.host;
  }

  private baseUrl(): string {
    const scheme = this.endpoint.protocol.replace(":", "");
    const bucket = this.cfg.bucket;
    return this.cfg.forcePathStyle ? `${scheme}://${this.host()}/${bucket}` : `${scheme}://${bucket}.${this.host()}`;
  }

  private sign(method: string, key: string, payload: Buffer, contentType?: string): { url: URL; headers: Record<string, string> } {
    const url = new URL(`${this.baseUrl()}/${key}`);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256").update(payload).digest("hex");
    const canonicalHeaders: [string, string][] = [
      ["host", url.host],
      ["x-amz-content-sha256", payloadHash],
      ["x-amz-date", amzDate],
    ];
    if (contentType) canonicalHeaders.push(["content-type", contentType]);
    canonicalHeaders.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const signedHeaders = canonicalHeaders.map(([k]) => k).join(";");
    const canonicalHeaderBlock = canonicalHeaders.map(([k, v]) => `${k}:${v}\n`).join("");
    const canonicalRequest = [method, url.pathname, "", canonicalHeaderBlock, signedHeaders, payloadHash].join("\n");
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");
    const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
    const kDate = hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.cfg.region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
    if (contentType) headers["content-type"] = contentType;
    if (payload.length > 0) headers["content-length"] = String(payload.length);
    return { url, headers };
  }

  private async request(method: string, key: string, payload: Buffer, contentType?: string): Promise<Response> {
    const { url, headers } = this.sign(method, key, payload, contentType);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const body = payload.length > 0 || method === "PUT" ? new Uint8Array(payload) : undefined;
      return await fetch(url, { method, headers, body, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async headBucket(): Promise<boolean> {
    const res = await this.request("HEAD", "", Buffer.alloc(0));
    return res.ok;
  }

  async createBucket(): Promise<void> {
    const res = await this.request("PUT", "", Buffer.alloc(0));
    // 200 OK or 409 BucketAlreadyOwnedByYou are both fine.
    if (!res.ok && res.status !== 409) {
      throw new Error(`createBucket failed: ${res.status}`);
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.request("PUT", key, body, contentType);
    if (!res.ok) throw new Error(`put failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.request("GET", key, Buffer.alloc(0));
    if (!res.ok) throw new Error(`get failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async has(key: string): Promise<boolean> {
    const res = await this.request("HEAD", key, Buffer.alloc(0));
    return res.ok;
  }
}

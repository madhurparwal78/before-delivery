import { createHmac, createHash } from "node:crypto";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** Minimal AWS SigV4 presigned client for the S3 surface this app needs. */
export class S3Client {
  constructor(private readonly cfg: S3Config) {}

  private objectUrl(key: string): URL {
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    const base = this.cfg.endpoint.replace(/\/$/, "");
    return this.cfg.forcePathStyle ? new URL(`${base}/${this.cfg.bucket}/${encoded}`) : new URL(`${base}/${encoded}`);
  }

  private bucketUrl(): URL {
    const base = this.cfg.endpoint.replace(/\/$/, "");
    return this.cfg.forcePathStyle ? new URL(`${base}/${this.cfg.bucket}`) : new URL(`${base}`);
  }

  /** Presigns a request as query parameters (UNSIGNED-PAYLOAD), so the caller needs no headers. */
  presign(method: string, url: URL, expiresSeconds: number): URL {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const params = new Map<string, string>([
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", `${this.cfg.accessKeyId}/${scope}`],
      ["X-Amz-Date", amzDate],
      ["X-Amz-Expires", String(expiresSeconds)],
      ["X-Amz-SignedHeaders", "host"],
    ]);
    const canonicalQuery = [...params.entries()]
      .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const canonicalRequest = [method, url.pathname, canonicalQuery, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
    const kDate = createHmac("sha256", `AWS4${this.cfg.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac("sha256", kDate).update(this.cfg.region).digest();
    const kService = createHmac("sha256", kRegion).update("s3").digest();
    const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
    const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
    return new URL(`${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`);
  }

  async putObject(key: string, body: Buffer): Promise<void> {
    const url = this.presign("PUT", this.objectUrl(key), 300);
    const res = await fetch(url, { method: "PUT", body: new Uint8Array(body) });
    if (!res.ok) throw new Error(`S3 put failed ${res.status}`);
  }

  async getObject(key: string): Promise<Buffer> {
    const url = this.presign("GET", this.objectUrl(key), 300);
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`S3 get failed ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async deleteObject(key: string): Promise<void> {
    const url = this.presign("DELETE", this.objectUrl(key), 300);
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed ${res.status}`);
  }

  async bucketExists(): Promise<boolean> {
    const url = this.presign("HEAD", this.bucketUrl(), 300);
    try {
      const res = await fetch(url, { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }

  async ensureBucket(): Promise<void> {
    if (await this.bucketExists()) return;
    const url = this.presign("PUT", this.bucketUrl(), 300);
    const res = await fetch(url, { method: "PUT" });
    if (!res.ok && res.status !== 409) throw new Error(`S3 create bucket failed ${res.status}`);
  }
}

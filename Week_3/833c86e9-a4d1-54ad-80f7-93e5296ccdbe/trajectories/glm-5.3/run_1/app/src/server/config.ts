import crypto from "node:crypto";

export type Config = {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  grading: boolean;
  holdMs: number;
  quoteTtlMs: number;
  reviewWindowMs: number;
  mapDebounceMs: number;
  typeDebounceMs: number;
  toastMs: number;
  pageSize: number;
  sseHeartbeatMs: number;
  loginRate: number;
  lookupRate: number;
  searchRate: number;
  importMaxBytes: number;
};

function int(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : def;
}

export function loadConfig(): Config {
  return {
    port: int("APP_PUBLIC_PORT", 4173),
    publicUrl: process.env.APP_PUBLIC_URL ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "",
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? "",
      region: process.env.S3_REGION ?? "",
      bucket: process.env.S3_BUCKET ?? "",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? ""
    },
    grading: process.env.KIP_GRADING === "1",
    holdMs: int("KIP_HOLD_MS", 900000),
    quoteTtlMs: int("KIP_QUOTE_TTL_MS", 600000),
    reviewWindowMs: int("KIP_REVIEW_WINDOW_MS", 2592000000),
    mapDebounceMs: int("KIP_MAP_DEBOUNCE_MS", 400),
    typeDebounceMs: int("KIP_TYPE_DEBOUNCE_MS", 200),
    toastMs: int("KIP_TOAST_MS", 5000),
    pageSize: int("KIP_PAGE_SIZE", 20),
    sseHeartbeatMs: int("KIP_SSE_HEARTBEAT_MS", 15000),
    loginRate: int("KIP_LOGIN_RATE", 10),
    lookupRate: int("KIP_LOOKUP_RATE", 10),
    searchRate: int("KIP_SEARCH_RATE", 120),
    importMaxBytes: int("KIP_IMPORT_MAX_BYTES", 1000000)
  };
}

/** S3 (MinIO) client over raw HTTP with AWS SigV4. */
export class S3 {
  private endpoint: string;
  private region: string;
  private bucket: string;
  private accessKey: string;
  private secretKey: string;
  pathStyle: boolean;

  constructor(cfg: Config["s3"]) {
    this.endpoint = cfg.endpoint.replace(/\/$/, "");
    this.region = cfg.region || "us-east-1";
    this.bucket = cfg.bucket;
    this.accessKey = cfg.accessKeyId;
    this.secretKey = cfg.secretAccessKey;
    this.pathStyle = cfg.forcePathStyle;
  }

  private host(): string {
    const u = new URL(this.endpoint);
    return u.host;
  }

  private base(): string {
    const u = new URL(this.endpoint);
    return u.origin;
  }

  private sign(method: string, path: string, query: string, payload: Buffer | string, extraHeaders: Record<string, string>): { url: string; headers: Record<string, string> } {
    const host = this.host();
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = crypto.createHash("sha256").update(payload).digest("hex");
    const headers: Record<string, string> = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...extraHeaders
    };
    const sortedKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k].trim()}\n`).join("");
    const signedHeaders = sortedKeys.join(";");
    const canonical = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, crypto.createHash("sha256").update(canonical).digest("hex")].join("\n");
    const kDate = crypto.createHmac("sha256", `AWS4${this.secretKey}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac("sha256", kDate).update(this.region).digest();
    const kService = crypto.createHmac("sha256", kRegion).update("s3").digest();
    const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();
    const signature = crypto.createHmac("sha256", kSigning).update(toSign).digest("hex");
    const auth = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { url: this.base() + path + (query ? "?" + query : ""), headers: { ...headers, Authorization: auth } };
  }

  private request(method: string, key: string | null, query: string, body: Buffer | string, extra: Record<string, string> = {}): Promise<{ status: number; body: Buffer }> {
    const path = this.pathStyle ? `/${this.bucket}${key ? "/" + key : ""}` : `/${key ?? ""}`;
    const { url, headers } = this.sign(method, path, query, body, extra);
    const init: RequestInit = { method, headers: { ...headers, ...extra } };
    if (body.length > 0) {
      const bytes = typeof body === "string" ? Buffer.from(body, "utf-8") : body;
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      init.body = copy;
    }
    return fetch(url, init).then(async (r) => ({
      status: r.status,
      body: Buffer.from(await r.arrayBuffer())
    }));
  }

  async ensureBucket(): Promise<void> {
    const r = await this.request("HEAD", null, "", "");
    if (r.status !== 200 && r.status !== 409 && r.status !== 403) {
      const c = await this.request("PUT", null, "", "");
      if (c.status !== 200 && c.status !== 409) throw new Error("bucket create failed " + c.status);
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const r = await this.request("PUT", key, "", body, { "content-type": contentType });
    if (r.status !== 200) throw new Error("s3 put failed " + r.status);
  }

  async get(key: string): Promise<Buffer | null> {
    const r = await this.request("GET", key, "", "");
    if (r.status === 200) return r.body;
    if (r.status === 404) return null;
    throw new Error("s3 get failed " + r.status);
  }
}

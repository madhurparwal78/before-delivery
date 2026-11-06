// Minimal S3 client speaking SigV4 to MinIO: put, get, delete, presigned GET.
import { createHash, createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3StatusError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
  }
}

export class Storage {
  private endpointUrl: URL;

  constructor(private cfg: S3Config) {
    this.endpointUrl = new URL(cfg.endpoint);
  }

  private objectPath(key: string): string {
    const enc = key.split("/").map(encodeURIComponent).join("/");
    return this.cfg.forcePathStyle ? `/${this.cfg.bucket}/${enc}` : `/${enc}`;
  }

  private signingKey(dateStamp: string): Buffer {
    const kDate = createHmac("sha256", `AWS4${this.cfg.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac("sha256", kDate).update(this.cfg.region).digest();
    const kService = createHmac("sha256", kRegion).update("s3").digest();
    return createHmac("sha256", kService).update("aws4_request").digest();
  }

  private sign(method: string, path: string, amzDate: string, payloadHash: string, extra: Record<string, string>): Record<string, string> {
    const dateStamp = amzDate.slice(0, 8);
    const headers: Record<string, string> = {
      host: this.endpointUrl.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    const signedList = Object.keys(headers).sort();
    const signed = signedList.join(";");
    const canonicalHeaders = signedList.map((k) => `${k}:${headers[k].trim()}\n`).join("");
    const canonicalRequest = [method, path, "", canonicalHeaders, signed, payloadHash].join("\n");
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");
    const signature = createHmac("sha256", this.signingKey(dateStamp)).update(stringToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
    return { ...headers, authorization, ...extra };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const amzDate = toAmzDate(new Date());
    const payloadHash = createHash("sha256").update(body).digest("hex");
    const headers = this.sign("PUT", this.objectPath(key), amzDate, payloadHash, {
      "content-type": contentType,
      "content-length": String(body.byteLength),
    });
    await this.raw("PUT", this.objectPath(key), body, headers);
  }

  async get(key: string): Promise<Buffer> {
    const headers = this.sign("GET", this.objectPath(key), toAmzDate(new Date()), EMPTY_SHA256, {});
    return this.raw("GET", this.objectPath(key), null, headers);
  }

  async delete(key: string): Promise<void> {
    const headers = this.sign("DELETE", this.objectPath(key), toAmzDate(new Date()), EMPTY_SHA256, {});
    await this.raw("DELETE", this.objectPath(key), null, headers);
  }

  /** A presigned GET link valid for the given number of seconds. */
  presignGet(key: string, expiresSeconds: number): string {
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const path = this.objectPath(key);
    const host = this.endpointUrl.host;
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const query: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.cfg.accessKeyId}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresSeconds),
      "X-Amz-SignedHeaders": "host",
    };
    const canonicalQuery = Object.keys(query)
      .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
      .sort()
      .join("&");
    const canonicalRequest = ["GET", path, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");
    const signature = createHmac("sha256", this.signingKey(dateStamp)).update(stringToSign).digest("hex");
    return `${this.endpointUrl.protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  /** Create the bucket if it does not exist; tolerate an existing one. */
  async ensureBucket(): Promise<void> {
    const path = this.cfg.forcePathStyle ? `/${this.cfg.bucket}` : "/";
    const headers = this.sign("PUT", path, toAmzDate(new Date()), EMPTY_SHA256, { "content-length": "0" });
    try {
      await this.raw("PUT", path, null, headers);
    } catch (e) {
      const status = e instanceof S3StatusError ? e.statusCode : -1;
      // MinIO answers 409 when the bucket is already owned.
      if (status !== 409) throw e;
    }
  }

  private raw(method: string, path: string, body: Buffer | null, headers: Record<string, string>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const isTls = this.endpointUrl.protocol === "https:";
      const req = (isTls ? httpsRequest : httpRequest)(
        {
          host: this.endpointUrl.hostname,
          port: this.endpointUrl.port,
          method,
          path,
          headers,
          timeout: 10_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            const status = res.statusCode ?? 0;
            if (status >= 200 && status < 300) resolve(buf);
            else reject(new S3StatusError(`s3 ${method} ${path} status ${status}: ${buf.toString().slice(0, 300)}`, status));
          });
        },
      );
      req.on("timeout", () => {
        req.destroy();
        reject(new S3StatusError("s3 timeout", 0));
      });
      req.on("error", (e) => reject(e instanceof S3StatusError ? e : new S3StatusError(`s3 error: ${String(e)}`, 0)));
      if (body) req.end(body);
      else req.end();
    });
  }
}

function toAmzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

function uriEncode(v: string): string {
  return encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

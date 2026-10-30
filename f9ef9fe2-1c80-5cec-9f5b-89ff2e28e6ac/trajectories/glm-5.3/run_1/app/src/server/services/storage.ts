import { createHmac, createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Config } from "../config";

export interface ObjectStorage {
  isUp(): Promise<boolean>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  has(key: string): Promise<boolean>;
}

interface S3Response {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function s3Request(config: Config, method: string, key: string, body: Buffer | null, contentType: string | null): Promise<S3Response> {
  return new Promise((resolve, reject) => {
    const url = new URL(config.s3Endpoint);
    const host = url.hostname;
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    const objectPath = `/${config.s3Bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
    const path = config.s3ForcePathStyle ? objectPath : key.split("/").map(encodeURIComponent).join("/");
    const hostHeader = config.s3ForcePathStyle ? host : `${config.s3Bucket}.${host}`;
    const payload = body ?? Buffer.alloc(0);
    const payloadHash = createHash("sha256").update(payload).digest("hex");
    const now = new Date();
    const amzDate = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
    const dateStamp = amzDate.slice(0, 8);
    const canonicalHeaders = `host:${hostHeader}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${dateStamp}/${config.s3Region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");
    const dateKey = createHmac("sha256", `AWS4${config.s3SecretAccessKey}`).update(dateStamp).digest();
    const regionKey = createHmac("sha256", dateKey).update(config.s3Region).digest();
    const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
    const signingKey = createHmac("sha256", serviceKey).update("aws4_request").digest();
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const doRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = doRequest(
      {
        host,
        port: Number.parseInt(port, 10),
        method,
        path,
        headers: {
          Host: hostHeader,
          Authorization: authorization,
          "x-amz-date": amzDate,
          "x-amz-content-sha256": payloadHash,
          ...(body !== null && contentType ? { "Content-Type": contentType } : {}),
          "Content-Length": String(payload.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
        });
      }
    );
    req.setTimeout(10000, () => {
      req.destroy(new Error("storage timeout"));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

export function makeStorage(config: Config): ObjectStorage {
  async function isUp(): Promise<boolean> {
    try {
      const res = await s3Request(config, "HEAD", "", null, null);
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  async function put(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await s3Request(config, "PUT", key, body, contentType);
    if (res.status !== 200) {
      throw new Error(`storage put failed (${res.status})`);
    }
  }

  async function get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const res = await s3Request(config, "GET", key, null, null);
    if (res.status !== 200) {
      return null;
    }
    const rawType = res.headers["content-type"];
    const contentType = Array.isArray(rawType) ? rawType[0] : rawType;
    return { body: res.body, contentType: contentType ?? "application/octet-stream" };
  }

  async function has(key: string): Promise<boolean> {
    try {
      const res = await s3Request(config, "HEAD", key, null, null);
      return res.status === 200;
    } catch {
      return false;
    }
  }

  return { isUp, put, get, has };
}

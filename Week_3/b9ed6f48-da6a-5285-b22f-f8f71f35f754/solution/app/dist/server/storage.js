// MinIO (S3 API) with AWS Signature V4: put, head and presigned GET links. The bucket stays
// private; the browser only ever receives presigned links (brief: Services › MinIO).
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
export class StorageUnreachable extends Error {
}
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
const encode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
function target(key) {
    const endpoint = new URL(config.s3.endpoint);
    const encodedKey = key.split("/").map(encode).join("/");
    if (config.s3.forcePathStyle) {
        const path = `/${config.s3.bucket}/${encodedKey}`;
        return { url: new URL(`${endpoint.origin}${path}`), path };
    }
    const path = `/${encodedKey}`;
    return { url: new URL(`${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}${path}`), path };
}
function stamp(now) {
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    return { amzDate, day: amzDate.slice(0, 8) };
}
function signature(day, stringToSign) {
    let key = hmac(`AWS4${config.s3.secretAccessKey}`, day);
    for (const part of [config.s3.region, "s3", "aws4_request"])
        key = hmac(key, part);
    return createHmac("sha256", key).update(stringToSign).digest("hex");
}
async function signedRequest(method, key, body, contentType) {
    const { url, path } = target(key);
    const { amzDate, day } = stamp(new Date());
    const payloadHash = sha256(body ?? "");
    const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
    if (contentType)
        headers["content-type"] = contentType;
    const names = Object.keys(headers).sort();
    const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
    const scope = `${day}/${config.s3.region}/s3/aws4_request`;
    const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
    const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature(day, toSign)}`;
    const { host: _host, ...sent } = headers;
    try {
        return await fetch(url, { method, headers: { ...sent, Authorization: authorization }, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(15000) });
    }
    catch {
        throw new StorageUnreachable();
    }
}
export async function putObject(key, body, contentType) {
    const response = await signedRequest("PUT", key, body, contentType);
    if (!response.ok)
        throw new StorageUnreachable(`PUT ${key} returned ${response.status}`);
}
/** True when the object exists; throws StorageUnreachable when MinIO cannot be reached. */
export async function objectExists(key) {
    const response = await signedRequest("HEAD", key);
    if (response.status === 200)
        return true;
    if (response.status === 404)
        return false;
    throw new StorageUnreachable(`HEAD ${key} returned ${response.status}`);
}
/** A presigned GET link that expires after MEDIA_LINK_SECONDS. */
export function presignedUrl(key) {
    const { url, path } = target(key);
    const { amzDate, day } = stamp(new Date());
    const scope = `${day}/${config.s3.region}/s3/aws4_request`;
    const query = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": `${config.s3.accessKeyId}/${scope}`,
        "X-Amz-Date": amzDate,
        "X-Amz-Expires": String(config.mediaLinkSeconds),
        "X-Amz-SignedHeaders": "host",
    };
    const canonicalQuery = Object.keys(query).sort().map((k) => `${encode(k)}=${encode(query[k])}`).join("&");
    const canonical = ["GET", path, canonicalQuery, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
    return `${url.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature(day, toSign)}`;
}
/** Ensures storage answers before a purchase or upload starts. */
export async function assertStorageReachable() {
    await objectExists("health/probe");
}

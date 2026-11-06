// Private MinIO bucket for hoof photos, spoken to with AWS Signature V4 over fetch (brief: Services, MinIO).
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
const TIMEOUT_MS = 10_000;
/** MinIO could not be reached or refused the request; routes answer the storage 503. */
export class StorageUnavailable extends Error {
}
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
const encodeKey = (key) => key.split("/").map(encodeURIComponent).join("/");
function objectUrl(key) {
    const { endpoint, bucket, forcePathStyle } = config.s3;
    const base = new URL(endpoint);
    if (forcePathStyle)
        return new URL(`${base.origin}/${bucket}/${encodeKey(key)}`);
    return new URL(`${base.protocol}//${bucket}.${base.host}/${encodeKey(key)}`);
}
async function send(method, key, body, contentType, timeoutMs = TIMEOUT_MS) {
    const url = objectUrl(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = amzDate.slice(0, 8);
    const payloadHash = sha256(body ?? "");
    const headers = {
        host: url.host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
    };
    if (contentType)
        headers["content-type"] = contentType;
    const signedNames = Object.keys(headers).sort();
    const canonical = [
        method,
        url.pathname,
        "",
        signedNames.map((name) => `${name}:${headers[name]}\n`).join(""),
        signedNames.join(";"),
        payloadHash,
    ].join("\n");
    const scope = `${day}/${config.s3.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
    let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
    for (const part of [config.s3.region, "s3", "aws4_request"])
        signingKey = hmac(signingKey, part);
    const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
    headers.authorization =
        `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
            `SignedHeaders=${signedNames.join(";")}, Signature=${signature}`;
    try {
        return await fetch(url, {
            method,
            headers,
            ...(body ? { body: new Uint8Array(body) } : {}),
            signal: AbortSignal.timeout(timeoutMs),
        });
    }
    catch (error) {
        throw new StorageUnavailable(`MinIO ${method} failed`, { cause: error });
    }
}
export async function putObject(key, body, contentType) {
    const response = await send("PUT", key, body, contentType);
    if (!response.ok)
        throw new StorageUnavailable(`MinIO PUT answered ${response.status}`);
}
export async function getObject(key) {
    const response = await send("GET", key);
    if (!response.ok)
        throw new StorageUnavailable(`MinIO GET answered ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}
export async function deleteObject(key) {
    const response = await send("DELETE", key);
    if (!response.ok && response.status !== 404)
        throw new StorageUnavailable(`MinIO DELETE answered ${response.status}`);
}
/** True when the bucket answers within the readiness bound. */
export async function storageReachable(timeoutMs) {
    try {
        const response = await send("HEAD", "", undefined, undefined, timeoutMs);
        return response.ok;
    }
    catch {
        return false;
    }
}

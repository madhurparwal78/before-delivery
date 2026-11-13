// The score store: MinIO over the S3 API, signed with AWS Signature V4 from the environment.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
const PROBE_TIMEOUT_MS = 2_000;
const TRANSFER_TIMEOUT_MS = 30_000;
const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
function encodePath(path) {
    return path
        .split("/")
        .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
        .join("/");
}
function objectUrl(key) {
    const store = config.scoreStore;
    const base = new URL(store.endpoint);
    if (store.forcePathStyle) {
        base.pathname = encodePath(`/${store.bucket}${key ? `/${key}` : ""}`);
    }
    else {
        base.hostname = `${store.bucket}.${base.hostname}`;
        base.pathname = encodePath(`/${key}`);
    }
    return base;
}
async function send(method, key, timeoutMs, body, contentType) {
    const store = config.scoreStore;
    const url = objectUrl(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body ?? "");
    const headers = {
        host: url.host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
    };
    if (contentType)
        headers["content-type"] = contentType;
    const names = Object.keys(headers).sort();
    const canonical = [
        method,
        url.pathname,
        "",
        names.map((name) => `${name}:${headers[name]}\n`).join(""),
        names.join(";"),
        payloadHash,
    ].join("\n");
    const scope = `${day}/${store.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
    let signingKey = hmac(`AWS4${store.secretAccessKey}`, day);
    for (const part of [store.region, "s3", "aws4_request"])
        signingKey = hmac(signingKey, part);
    const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
    const { host: _host, ...sent } = headers;
    const response = await fetch(url, {
        method,
        headers: {
            ...sent,
            authorization: `AWS4-HMAC-SHA256 Credential=${store.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
}
/** True when the bucket answers within two seconds. */
export async function storageUp() {
    try {
        return (await send("HEAD", "", PROBE_TIMEOUT_MS)).status === 200;
    }
    catch {
        return false;
    }
}
/**
 * Writes the object, then reads back its size and checksum. True only when the store confirms the
 * exact bytes; any failure or mismatch is false.
 */
export async function putConfirmed(key, data, contentType) {
    try {
        const written = await send("PUT", key, TRANSFER_TIMEOUT_MS, data, contentType);
        if (written.status !== 200)
            return false;
        const stored = await send("HEAD", key, TRANSFER_TIMEOUT_MS);
        const etag = (stored.headers.get("etag") ?? "").replaceAll('"', "");
        const md5 = createHash("md5").update(data).digest("hex");
        return stored.status === 200 && Number(stored.headers.get("content-length")) === data.length && etag === md5;
    }
    catch {
        return false;
    }
}
/** The object's bytes, or null when the store cannot be read. */
export async function getObject(key) {
    try {
        const read = await send("GET", key, TRANSFER_TIMEOUT_MS);
        return read.status === 200 ? read.body : null;
    }
    catch {
        return null;
    }
}
export async function deleteObject(key) {
    try {
        await send("DELETE", key, TRANSFER_TIMEOUT_MS);
    }
    catch (error) {
        console.error("score store cleanup failed", key, error instanceof Error ? error.message : error);
    }
}

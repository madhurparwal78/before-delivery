"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.S3Error = exports.S3Unavailable = void 0;
exports.putObject = putObject;
exports.statObject = statObject;
exports.getObject = getObject;
exports.deleteObject = deleteObject;
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
const config_1 = require("../config");
class S3Unavailable extends Error {
    cause;
    constructor(cause) {
        super(`MinIO is unreachable: ${cause}`);
        this.cause = cause;
    }
}
exports.S3Unavailable = S3Unavailable;
class S3Error extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
exports.S3Error = S3Error;
const SERVICE = "s3";
function sha256Hex(data) {
    return (0, node_crypto_1.createHash)("sha256").update(data).digest("hex");
}
function hmac(key, data) {
    return (0, node_crypto_1.createHmac)("sha256", key).update(data).digest();
}
function uriEncode(value, isPath = false) {
    let out = "";
    for (const ch of encodeURIComponent(value)) {
        if (ch === "%")
            continue;
        out += ch;
    }
    // encodeURIComponent handles most; re-add characters it keeps but S3 encodes
    return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
async function s3Request(req) {
    const url = new URL(db_1.config.s3Endpoint);
    const host = url.hostname;
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    const canonicalUri = `/${db_1.config.s3Bucket}/${req.key}`.split("/").map((p, i) => (i === 0 ? p : uriEncode(p))).join("/");
    const payloadHash = sha256Hex(req.body ?? Buffer.alloc(0));
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const headers = {
        host: `${host}:${port}`,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
    };
    if (req.contentType)
        headers["content-type"] = req.contentType;
    const headerKeys = Object.keys(headers).sort();
    const canonicalHeaders = headerKeys.map((k) => `${k}:${headers[k]}\n`).join("");
    const signedHeaders = headerKeys.join(";");
    const canonicalRequest = [
        req.method,
        canonicalUri,
        "",
        canonicalHeaders,
        signedHeaders,
        payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/${db_1.config.s3Region}/${SERVICE}/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
    const kDate = hmac(`AWS4${db_1.config.s3SecretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, db_1.config.s3Region);
    const kService = hmac(kRegion, SERVICE);
    const kSigning = hmac(kService, "aws4_request");
    const signature = (0, node_crypto_1.createHmac)("sha256", kSigning).update(stringToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${db_1.config.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? config_1.PRODUCER_TIMEOUT_MS);
    try {
        const res = await fetch(`${db_1.config.s3Endpoint}${canonicalUri}`, {
            method: req.method,
            headers: { ...headers, Authorization: authorization },
            body: req.body,
            signal: controller.signal,
        });
        const buf = Buffer.from(await res.arrayBuffer());
        const outHeaders = {};
        res.headers.forEach((v, k) => {
            outHeaders[k.toLowerCase()] = v;
        });
        return { status: res.status, headers: outHeaders, body: buf };
    }
    catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
            throw new S3Unavailable("timed out");
        }
        throw new S3Unavailable(e instanceof Error ? e.message : String(e));
    }
    finally {
        clearTimeout(timer);
    }
}
async function putObject(key, body, contentType) {
    const res = await s3Request({ method: "PUT", key, body, contentType });
    if (res.status !== 200) {
        throw new S3Error(res.status, "PutObject", `MinIO refused the upload: ${res.status}`);
    }
}
async function statObject(key) {
    const res = await s3Request({ method: "HEAD", key });
    if (res.status === 200) {
        return { exists: true, bytes: parseInt(res.headers["content-length"] ?? "0", 10) };
    }
    if (res.status === 404)
        return { exists: false, bytes: 0 };
    throw new S3Error(res.status, "HeadObject", `MinIO refused the check: ${res.status}`);
}
async function getObject(key) {
    const res = await s3Request({ method: "GET", key });
    if (res.status === 200)
        return res.body;
    if (res.status === 404)
        return null;
    throw new S3Error(res.status, "GetObject", `MinIO refused the read: ${res.status}`);
}
async function deleteObject(key) {
    const res = await s3Request({ method: "DELETE", key });
    if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
        throw new S3Error(res.status, "DeleteObject", `MinIO refused the delete: ${res.status}`);
    }
}

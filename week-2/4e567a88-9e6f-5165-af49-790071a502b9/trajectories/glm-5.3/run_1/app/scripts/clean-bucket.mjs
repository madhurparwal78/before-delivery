// One-off cleanup: remove test objects from a MinIO bucket via ListObjectsV2.
// usage: node scripts/clean-bucket.mjs [bucket]
import { createHash, createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";

const bucket = process.argv[2] ?? process.env.S3_BUCKET ?? "gf-dev";
const endpoint = process.env.S3_ENDPOINT ?? "http://minio:9000";
const region = process.env.S3_REGION ?? "us-east-1";
const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? "";
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? "";
const url = new URL(endpoint);

function toAmzDate(d = new Date()) {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}
function sign(method, path, query, payloadHash = createHash("sha256").update("").digest("hex")) {
  const amzDate = toAmzDate();
  const dateStamp = amzDate.slice(0, 8);
  const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedList = Object.keys(headers).sort();
  const signed = signedList.join(";");
  const canonicalHeaders = signedList.map((k) => `${k}:${headers[k]}\n`).join("");
  const canonicalQuery = [...query.entries()].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).sort().join("&");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signed, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
  const kDate = createHmac("sha256", `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update("s3").digest();
  const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}` };
}

function raw(method, path, query) {
  return new Promise((resolve, reject) => {
    const headers = sign(method, path, query);
    const req = httpRequest({ host: url.hostname, port: url.port, method, path: `${path}?${[...query.entries()].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end();
  });
}

let deleted = 0;
let token = "";
do {
  const query = new URLSearchParams({ "list-type": "2", "max-keys": "1000" });
  if (token) query.set("continuation-token", token);
  const res = await raw("GET", `/${bucket}`, query);
  if (res.status !== 200) {
    console.log(`list failed: ${res.status}`);
    break;
  }
  const keys = [...res.body.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(res.body)?.[1] ?? "";
  for (const key of keys) {
    const del = await raw("DELETE", `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`, new URLSearchParams());
    if (del.status < 300) deleted += 1;
  }
} while (token);
console.log(`deleted ${deleted} objects from ${bucket}`);

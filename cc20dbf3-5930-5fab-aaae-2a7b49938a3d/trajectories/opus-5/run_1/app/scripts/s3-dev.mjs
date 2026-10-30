/** A minimal signed S3 client for the development scripts. */
import { createHash, createHmac } from 'node:crypto';

const endpoint = new URL(process.env.S3_ENDPOINT);
const bucket = process.env.S3_BUCKET;
const region = process.env.S3_REGION;

function sign(method, path, query) {
  const amzDate = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const shortDate = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256').update('').digest('hex');
  const headers = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    path,
    query,
    names.map((name) => `${name}:${headers[name]}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${shortDate}/${region}/s3/aws4_request`;
  const toSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonical).digest('hex'),
  ].join('\n');
  const hmac = (secret, data) => createHmac('sha256', secret).update(data).digest();
  const signing = hmac(
    hmac(hmac(hmac(`AWS4${process.env.S3_SECRET_ACCESS_KEY}`, shortDate), region), 's3'),
    'aws4_request',
  );
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${process.env.S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${hmac(signing, toSign).toString('hex')}`;
  return {
    url: `${endpoint.origin}${path}${query === '' ? '' : `?${query}`}`,
    headers,
  };
}

function encodeKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

export async function listBucket() {
  const request = sign('GET', `/${bucket}`, 'list-type=2&max-keys=1000');
  const response = await fetch(request.url, { headers: request.headers });
  const xml = await response.text();
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]);
}

export async function emptyBucket() {
  for (const key of await listBucket()) {
    const request = sign('DELETE', `/${bucket}/${encodeKey(key)}`, '');
    await fetch(request.url, { method: 'DELETE', headers: request.headers });
  }
}

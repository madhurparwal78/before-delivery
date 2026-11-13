import crypto from 'node:crypto';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
}

export function s3ConfigFromEnv(): S3Config {
  return {
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? '',
    accessKey: process.env.S3_ACCESS_KEY_ID ?? '',
    secretKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  };
}

const hmac = (key: crypto.BinaryLike, data: string): Buffer => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
const sha256Hex = (data: crypto.BinaryLike): string => crypto.createHash('sha256').update(data).digest('hex');

function urlFor(config: S3Config, key: string): { url: URL; host: string; path: string } {
  const endpoint = new URL(config.endpoint);
  const host = config.forcePathStyle ? endpoint.host : `${config.bucket}.${endpoint.host}`;
  const path = key ? `/${config.bucket}/${key}` : `/${config.bucket}/`;
  return { url: new URL(`${endpoint.protocol}//${host}${path}`), host, path };
}

// One signed request. Returns the fetch Response, whatever its status.
export async function s3Fetch(config: S3Config, method: string, key: string, body: Buffer | null, contentType: string): Promise<Response> {
  const { url, host, path } = urlFor(config, key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);
  const headerNames = ['host', 'x-amz-content-sha256', 'x-amz-date'];
  const headerValues: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) {
    headerNames.push('content-type');
    headerValues['content-type'] = contentType;
  }
  headerNames.sort();
  const canonicalHeaders = headerNames.map((name) => `${name}:${headerValues[name].trim()}\n`).join('');
  const canonicalUri = path.split('/').map(encodeURIComponent).join('/');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, headerNames.join(';'), payloadHash].join('\n');
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${config.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  const authorisation = `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${headerNames.join(';')}, Signature=${signature}`;
  const requestHeaders: Record<string, string> = {};
  for (const name of headerNames) requestHeaders[name] = headerValues[name];
  requestHeaders.authorization = authorisation;
  return fetch(url, {
    method,
    headers: requestHeaders,
    body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(payload),
    signal: AbortSignal.timeout(2000),
  });
}

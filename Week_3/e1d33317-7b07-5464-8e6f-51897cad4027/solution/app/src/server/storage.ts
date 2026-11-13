// MinIO over the S3 API: SigV4-signed requests with bounded waits. Every call tries MinIO afresh.

import { createHash, createHmac } from 'node:crypto'
import { config } from './config.js'
import { StorageUnavailable } from './errors.js'

const TIMEOUT_MS = 5000
let bucketReady = false

const sha256 = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: Uint8Array | string, data: string): Buffer => createHmac('sha256', key).update(data).digest()
const encodeSegment = (segment: string): string => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

interface Target {
  url: string
  host: string
  path: string
}

function target(key: string): Target {
  const { endpoint, bucket } = config.s3
  if (!endpoint || !bucket) throw new StorageUnavailable()
  const base = new URL(endpoint)
  const keyPath = key ? `/${key.split('/').map(encodeSegment).join('/')}` : ''
  if (config.s3.forcePathStyle) {
    const path = `${base.pathname.replace(/\/$/, '')}/${bucket}${keyPath}`
    return { url: `${base.origin}${path}`, host: base.host, path }
  }
  const host = `${bucket}.${base.host}`
  return { url: `${base.protocol}//${host}${keyPath || '/'}`, host, path: keyPath || '/' }
}

async function send(method: string, key: string, body?: Uint8Array, headers: Record<string, string> = {}, query = ''): Promise<Response> {
  const { accessKeyId, secretAccessKey, region } = config.s3
  if (!accessKeyId || !secretAccessKey) throw new StorageUnavailable()
  const { url, host, path } = target(key)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const payloadHash = sha256(body ?? '')
  const signed: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...headers }
  const names = Object.keys(signed).sort()
  const canonical = [
    method, path, query, names.map((n) => `${n}:${signed[n]}\n`).join(''), names.join(';'), payloadHash,
  ].join('\n')
  const scope = `${day}/${region}/s3/aws4_request`
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`
  try {
    return await fetch(query ? `${url}?${query}` : url, {
      method,
      headers: { ...signed, authorization },
      body: body as BodyInit | undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    bucketReady = false
    throw new StorageUnavailable(error)
  }
}

async function ensureBucket(): Promise<void> {
  if (bucketReady) return
  const head = await send('HEAD', '')
  if (head.status === 404) {
    const made = await send('PUT', '')
    if (!made.ok && made.status !== 409) throw new StorageUnavailable()
  } else if (!head.ok) {
    throw new StorageUnavailable()
  }
  bucketReady = true
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await ensureBucket()
  const response = await send('PUT', key, body, { 'content-type': contentType })
  if (!response.ok) throw new StorageUnavailable()
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  await ensureBucket()
  const response = await send('GET', key)
  if (response.status === 404) return null
  if (!response.ok) throw new StorageUnavailable()
  try {
    return new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    throw new StorageUnavailable(error)
  }
}

/** Creates the bucket at start when MinIO is reachable; a failure is retried on the next request. */
export function prepareStorage(): void {
  ensureBucket().catch(() => undefined)
}

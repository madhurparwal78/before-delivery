import { createHash, createHmac } from 'node:crypto'
import { config } from './config'
import { refuse } from './errors'

const TIMEOUT_MS = 8000

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function encode(part: string): string {
  return encodeURIComponent(part).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
}

interface Reply {
  status: number
  body: Buffer
}

/** One signed request (AWS Signature Version 4) to the object store; an unreachable store is `storage_unavailable`. */
async function send(method: string, key: string, query: Record<string, string> = {}, body: Uint8Array = new Uint8Array(), contentType?: string): Promise<Reply> {
  const { endpoint, bucket, region, pathStyle, accessKeyId, secretAccessKey } = config.s3
  const base = new URL(endpoint)
  const host = pathStyle ? base.host : `${bucket}.${base.host}`
  const path = pathStyle ? `/${encode(bucket)}${key ? `/${key.split('/').map(encode).join('/')}` : ''}` : `/${key.split('/').map(encode).join('/')}`
  const canonicalQuery = Object.entries(query)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, value]) => `${encode(name)}=${encode(value)}`)
    .join('&')
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const payloadHash = sha256(body)
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join('')
  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${day}/${region}/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  const url = `${base.protocol}//${host}${path}${canonicalQuery ? `?${canonicalQuery}` : ''}`
  try {
    const response = await fetch(url, {
      method,
      headers: { ...headers, authorization, ...(contentType ? { 'content-type': contentType } : {}) },
      body: method === 'PUT' ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()) }
  } catch {
    throw refuse.storageUnavailable()
  }
}

function succeeded(reply: Reply): Reply {
  if (reply.status >= 400) throw refuse.storageUnavailable()
  return reply
}

/** Writes an object and confirms the bucket holds it before returning. */
export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  succeeded(await send('PUT', key, {}, body, contentType))
  succeeded(await send('HEAD', key))
}

/** The object's bytes, or null when the bucket has no such object. */
export async function getObject(key: string): Promise<Buffer | null> {
  const reply = await send('GET', key)
  if (reply.status === 404) return null
  return succeeded(reply).body
}

export async function deleteObject(key: string): Promise<void> {
  succeeded(await send('DELETE', key))
}

async function listKeys(prefix: string): Promise<string[]> {
  const reply = succeeded(await send('GET', '', { 'list-type': '2', prefix }))
  return [...reply.body.toString('utf8').matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => match[1] ?? '')
}

/** Removes every object under a prefix and confirms the prefix lists nothing. */
export async function deletePrefix(prefix: string): Promise<void> {
  for (const key of await listKeys(prefix)) await deleteObject(key)
  if ((await listKeys(prefix)).length > 0) throw refuse.storageUnavailable()
}

export async function ensureBucket(): Promise<void> {
  if ((await send('HEAD', '')).status === 404) succeeded(await send('PUT', ''))
}

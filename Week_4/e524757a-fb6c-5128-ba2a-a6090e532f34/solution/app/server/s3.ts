/** MinIO over the S3 API, signed with AWS Signature V4. Every call has a timeout; any failure is a `StorageError`. */
import { createHash, createHmac } from 'node:crypto'
import { config } from './config'

export class StorageError extends Error {}

const TIMEOUT_MS = 5000
const PROBE_TIMEOUT_MS = 1500

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest()
const encode = (segment: string): string => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

async function send(method: string, key: string, body: Buffer = Buffer.alloc(0), contentType?: string, timeout = TIMEOUT_MS): Promise<Response> {
  const { endpoint, region, bucket, pathStyle, accessKeyId, secretAccessKey } = config.s3
  const base = new URL(endpoint)
  const host = pathStyle ? base.host : `${bucket}.${base.host}`
  const path = (pathStyle ? `/${bucket}` : '') + (key ? `/${key.split('/').map(encode).join('/')}` : '')
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const day = now.slice(0, 8)
  const payload = sha256(body)
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payload, 'x-amz-date': now }
  if (contentType) headers['content-type'] = contentType
  const names = Object.keys(headers).sort()
  const scope = `${day}/${region}/s3/aws4_request`
  const canonical = [method, path || '/', '', names.map((n) => `${n}:${headers[n]}\n`).join(''), names.join(';'), payload].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', now, scope, sha256(canonical)].join('\n')
  const signingKey = [day, region, 's3', 'aws4_request'].reduce<string | Buffer>((k, part) => hmac(k, part), `AWS4${secretAccessKey}`)
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`
  try {
    return await fetch(`${base.protocol}//${host}${path}`, {
      method,
      headers,
      body: method === 'PUT' ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    })
  } catch {
    throw new StorageError(`${method} ${key} failed`)
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send('PUT', key, body, contentType)
  if (!response.ok) throw new StorageError(`PUT ${key}: ${response.status}`)
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send('GET', key)
  if (!response.ok) throw new StorageError(`GET ${key}: ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send('DELETE', key)
  if (!response.ok) throw new StorageError(`DELETE ${key}: ${response.status}`)
}

/** True when the bucket answers. */
export async function storageAnswers(): Promise<boolean> {
  try {
    return (await send('HEAD', '', Buffer.alloc(0), undefined, PROBE_TIMEOUT_MS)).ok
  } catch {
    return false
  }
}

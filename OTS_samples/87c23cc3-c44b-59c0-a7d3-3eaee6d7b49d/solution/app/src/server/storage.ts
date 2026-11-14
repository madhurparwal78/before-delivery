import { createHash, createHmac } from 'node:crypto'
import { config } from './config.ts'

/** Raised when object storage cannot be reached or refuses the call. */
class StorageError extends Error {}

const TIMEOUT_MS = 2000
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex')

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/')
}

interface Request {
  method: 'GET' | 'PUT' | 'HEAD'
  key: string
  body?: Buffer
  headers?: Record<string, string>
}

function target(key: string): { url: URL; path: string } {
  const base = new URL(config.storage.endpoint)
  if (config.storage.forcePathStyle) {
    const path = `${base.pathname.replace(/\/$/, '')}/${config.storage.bucket}${key ? `/${key}` : ''}`
    return { url: new URL(`${base.origin}${encodePath(path)}`), path: encodePath(path) }
  }
  const host = `${config.storage.bucket}.${base.host}`
  const path = `${base.pathname.replace(/\/$/, '')}/${key}`
  return { url: new URL(`${base.protocol}//${host}${encodePath(path)}`), path: encodePath(path) }
}

/** A fresh signed request for every operation, so storage that returns works again without a restart. */
async function send(request: Request): Promise<Response> {
  const { url, path } = target(request.key)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const payload = request.body ? createHash('sha256').update(request.body).digest('hex') : EMPTY_SHA256
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payload,
    'x-amz-date': amzDate,
    ...Object.fromEntries(Object.entries(request.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])),
  }
  const names = Object.keys(headers).sort()
  const canonical = [
    request.method,
    path,
    '',
    ...names.map((name) => `${name}:${(headers[name] as string).trim()}`),
    '',
    names.join(';'),
    payload,
  ].join('\n')
  const scope = `${day}/${config.storage.region}/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonical).digest('hex')].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.storage.secretAccessKey}`, day), config.storage.region), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`
  try {
    return await fetch(url, {
      method: request.method,
      headers,
      body: request.body ? new Uint8Array(request.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new StorageError('storage unreachable')
  }
}

async function ensureBucket(): Promise<void> {
  const head = await send({ method: 'HEAD', key: '' })
  if (head.ok) return
  if (head.status !== 404) throw new StorageError(`bucket check answered ${head.status}`)
  const made = await send({ method: 'PUT', key: '' })
  if (!made.ok) throw new StorageError(`bucket creation answered ${made.status}`)
}

/** True when object storage answers and the bucket exists or can be created. */
export async function pingStorage(): Promise<boolean> {
  try {
    await ensureBucket()
    return true
  } catch {
    return false
  }
}

/** Writes the object, reads its metadata back from storage and refuses unless size and SHA-256 match. */
export async function putObject(key: string, body: Buffer, sha256: string): Promise<void> {
  await ensureBucket()
  const put = await send({
    method: 'PUT',
    key,
    body,
    headers: { 'content-type': 'application/sql', 'x-amz-meta-sha256': sha256 },
  })
  if (!put.ok) throw new StorageError(`write answered ${put.status}`)
  const head = await send({ method: 'HEAD', key })
  if (!head.ok) throw new StorageError(`metadata read answered ${head.status}`)
  if (Number(head.headers.get('content-length')) !== body.length || head.headers.get('x-amz-meta-sha256') !== sha256) {
    throw new StorageError('stored object does not match what was written')
  }
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send({ method: 'GET', key })
  if (!response.ok) throw new StorageError(`read answered ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

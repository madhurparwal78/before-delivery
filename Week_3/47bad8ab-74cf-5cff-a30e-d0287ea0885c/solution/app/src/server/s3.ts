import { createHash, createHmac } from 'node:crypto'
import { config } from './config.ts'
import { ApiError } from './errors.ts'

const REQUEST_TIMEOUT_MS = 5000
const PROBE_TIMEOUT_MS = 1000

const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Uint8Array, data: string): Buffer => createHmac('sha256', key).update(data).digest()

const endpoint = new URL(config.s3.endpoint)
const bucketPath = `/${encodeURIComponent(config.s3.bucket)}`
const objectPath = (key: string): string => `${bucketPath}/${key.split('/').map(encodeURIComponent).join('/')}`

interface Request {
  method: 'GET' | 'PUT' | 'HEAD'
  path: string
  body?: Uint8Array
  contentType?: string
  timeoutMs?: number
}

async function send({ method, path, body, contentType, timeoutMs = REQUEST_TIMEOUT_MS }: Request): Promise<Response> {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const payloadHash = sha256Hex(body ?? '')
  const headers: Record<string, string> = { host: endpoint.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
  if (contentType) headers['content-type'] = contentType
  const names = Object.keys(headers).sort()
  const canonical = [method, path, '', names.map((name) => `${name}:${headers[name]}\n`).join(''), names.join(';'), payloadHash].join('\n')
  const scope = `${day}/${config.s3.region}/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n')
  const signingKey = ['aws4_request', 's3', config.s3.region, day].reduceRight<Buffer | string>((key, part) => hmac(key, part), `AWS4${config.s3.secretAccessKey}`)
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`
  try {
    return await fetch(new URL(path, endpoint), { method, headers, body: body && new Uint8Array(body), signal: AbortSignal.timeout(timeoutMs) })
  } catch {
    throw new ApiError('storage_unavailable')
  }
}

let bucketReady = false

async function ensureBucket(): Promise<void> {
  if (bucketReady) return
  const head = await send({ method: 'HEAD', path: bucketPath })
  if (head.status === 404) {
    const created = await send({ method: 'PUT', path: bucketPath })
    if (created.status >= 300) throw new ApiError('storage_unavailable')
  } else if (!head.ok) throw new ApiError('storage_unavailable')
  bucketReady = true
}

/** Whether object storage answers right now; never throws. */
export async function storageReachable(): Promise<boolean> {
  try {
    const head = await send({ method: 'HEAD', path: bucketPath, timeoutMs: PROBE_TIMEOUT_MS })
    if (head.status === 404) await ensureBucket()
    else if (!head.ok) return false
    bucketReady = true
    return true
  } catch {
    return false
  }
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await ensureBucket()
  const response = await send({ method: 'PUT', path: objectPath(key), body, contentType })
  if (!response.ok) throw new ApiError('storage_unavailable')
}

export async function getObject(key: string): Promise<Buffer> {
  await ensureBucket()
  const response = await send({ method: 'GET', path: objectPath(key) })
  if (!response.ok) throw new ApiError('storage_unavailable')
  return Buffer.from(await response.arrayBuffer())
}

export async function objectExists(key: string): Promise<boolean> {
  await ensureBucket()
  const response = await send({ method: 'HEAD', path: objectPath(key) })
  if (response.status === 404) return false
  if (!response.ok) throw new ApiError('storage_unavailable')
  return true
}

import { createHash, createHmac } from 'node:crypto'
import { config } from './config'

export class StorageUnavailable extends Error {}

let forcedDown = false
let pingedAt = 0
let pingOk = false

export const setDown = (down: boolean): void => {
  forcedDown = down
  pingedAt = 0
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest()

function encodePath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')
}

async function send(method: 'GET' | 'PUT' | 'HEAD', key: string, body?: Buffer, contentType?: string): Promise<{ status: number; body: Buffer }> {
  if (forcedDown) throw new StorageUnavailable('storage is down')
  const { endpoint, bucket, region, pathStyle, accessKeyId, secretAccessKey } = config.s3
  const base = new URL(endpoint)
  const host = pathStyle ? base.host : `${bucket}.${base.host}`
  const path = '/' + encodePath(pathStyle ? (key ? `${bucket}/${key}` : bucket) : key)
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = stamp.slice(0, 8)
  const payloadHash = sha256(body ?? '')
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp }
  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonical = [method, path, '', ...Object.keys(headers).sort().map((name) => `${name}:${headers[name]}`), '', signedHeaders, payloadHash].join('\n')
  const scope = `${day}/${region}/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  if (contentType) headers['content-type'] = contentType
  try {
    const response = await fetch(`${base.protocol}//${host}${path}`, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(4000) })
    const data = Buffer.from(await response.arrayBuffer())
    if (response.status >= 500) throw new StorageUnavailable(`storage answered ${response.status}`)
    return { status: response.status, body: data }
  } catch (error) {
    throw error instanceof StorageUnavailable ? error : new StorageUnavailable(String(error))
  }
}

export async function put(key: string, body: string | Buffer, contentType: string): Promise<void> {
  const result = await send('PUT', key, Buffer.from(body), contentType)
  if (result.status !== 200) throw new StorageUnavailable(`put ${key} answered ${result.status}`)
}

export async function get(key: string): Promise<Buffer | null> {
  const result = await send('GET', key)
  if (result.status === 404) return null
  if (result.status !== 200) throw new StorageUnavailable(`get ${key} answered ${result.status}`)
  return result.body
}

export async function exists(key: string): Promise<boolean> {
  return (await send('HEAD', key)).status === 200
}

export async function healthy(): Promise<boolean> {
  if (forcedDown) return false
  if (Date.now() - pingedAt < 1000) return pingOk
  try {
    pingOk = (await send('HEAD', '')).status === 200
  } catch {
    pingOk = false
  }
  pingedAt = Date.now()
  return pingOk
}

import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3'
import { config } from './db.js'

/** Live probes used by the admin health panel. */
export async function probe_killbill(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2_000)
  try {
    const reply = await fetch(`${config().killbill_url}/1.0/kb/tenants`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${config().killbill_username}:${config().killbill_password}`).toString('base64'),
        'X-Killbill-ApiKey': config().killbill_api_key,
        'X-Killbill-ApiSecret': config().killbill_api_secret,
      },
      signal: controller.signal,
    })
    return reply.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function probe_minio(): Promise<boolean> {
  const s3 = new S3Client({
    region: config().s3_region,
    endpoint: config().s3_endpoint,
    forcePathStyle: config().s3_force_path_style,
    credentials: { accessKeyId: config().s3_access_key_id, secretAccessKey: config().s3_secret_access_key },
    requestHandler: { requestTimeout: 2_000, connectionTimeout: 1_000 },
  })
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config().s3_bucket }))
    return true
  } catch {
    return false
  }
}

import net from 'node:net'

export function probe_smtp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: config().smtp_host, port: config().smtp_port })
    const done = (result: boolean) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(2_000, () => done(false))
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
  })
}

export async function probe_pocketbase(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2_000)
  try {
    const reply = await fetch(`${config().pocketbase_url}/api/health`, { signal: controller.signal })
    return reply.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function probe_postgres(): Promise<boolean> {
  try {
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: config().database_url, connectionTimeoutMillis: 2_000 })
    await pool.query('SELECT 1')
    await pool.end()
    return true
  } catch {
    return false
  }
}

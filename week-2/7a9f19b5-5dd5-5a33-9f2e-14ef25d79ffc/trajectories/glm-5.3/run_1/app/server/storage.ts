import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { config } from './db.js'

export interface Storage {
  put(key: string, data: Buffer | Uint8Array, content_type: string): Promise<void>
  get(key: string): Promise<Buffer>
  exists(key: string): Promise<boolean>
}

export class StorageUnavailable extends Error {}

export function create_storage(): Storage {
  const s3 = new S3Client({
    region: config().s3_region,
    endpoint: config().s3_endpoint,
    forcePathStyle: config().s3_force_path_style,
    credentials: { accessKeyId: config().s3_access_key_id, secretAccessKey: config().s3_secret_access_key },
    requestHandler: { requestTimeout: 10_000, connectionTimeout: 5_000 },
  })
  const bucket = config().s3_bucket
  return {
    async put(key, data, content_type) {
      try {
        await s3.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: content_type }),
        )
      } catch {
        throw new StorageUnavailable('put failed')
      }
    },
    async get(key) {
      try {
        const reply = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        return Buffer.from(await reply.Body!.transformToByteArray())
      } catch {
        throw new StorageUnavailable('get failed')
      }
    },
    async exists(key) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return true
      } catch {
        return false
      }
    },
  }
}

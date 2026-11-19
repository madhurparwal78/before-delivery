import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand
} from '@aws-sdk/client-s3'
import { config } from './config.js'

export const UPLOAD_503 = "Files can't be saved right now. Try again in a minute."
export const READ_503 = "Files can't be loaded right now. Try again in a minute."

// The real client. Tests on the MinIO-down instance point at an unreachable
// endpoint, so every command genuinely fails; this flag only shadows the
// grading outage route, through the same code path.
let outageForced = false

export function setStoreOutage(down: boolean): void {
  outageForced = down
}

export function storeDown(): boolean {
  return outageForced
}

const client = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey
  }
})

export class StoreError extends Error {}

export async function putFile(
  lessonId: string,
  fileId: string,
  bytes: Buffer,
  contentType: string
): Promise<void> {
  if (storeDown()) throw new StoreError(UPLOAD_503)
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: `lessons/${lessonId}/${fileId}`,
        Body: bytes,
        ContentType: contentType
      })
    )
    await confirmFile(lessonId, fileId, bytes.length)
  } catch (error) {
    if (error instanceof StoreError) throw error
    throw new StoreError(UPLOAD_503)
  }
}

async function confirmFile(lessonId: string, fileId: string, bytes: number): Promise<void> {
  if (storeDown()) throw new StoreError(UPLOAD_503)
  const answer = await client.send(
    new HeadObjectCommand({ Bucket: config.s3.bucket, Key: `lessons/${lessonId}/${fileId}` })
  )
  if ((answer.ContentLength ?? -1) !== bytes) throw new StoreError(UPLOAD_503)
}

export async function getFile(
  lessonId: string,
  fileId: string
): Promise<{ bytes: Buffer; contentType: string }> {
  if (storeDown()) throw new StoreError(READ_503)
  try {
    const answer = await client.send(
      new GetObjectCommand({ Bucket: config.s3.bucket, Key: `lessons/${lessonId}/${fileId}` })
    )
    const body = answer.Body
    if (!body) throw new StoreError(READ_503)
    const chunks: Buffer[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const chunk of body as any) chunks.push(Buffer.from(chunk))
    return { bytes: Buffer.concat(chunks), contentType: answer.ContentType || 'application/octet-stream' }
  } catch (error) {
    if (error instanceof StoreError) throw error
    throw new StoreError(READ_503)
  }
}

export async function deleteFile(lessonId: string, fileId: string): Promise<void> {
  if (storeDown()) throw new StoreError(UPLOAD_503)
  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: `lessons/${lessonId}/${fileId}` })
    )
  } catch {
    // A missing object already satisfies the removal.
  }
}

export async function storeReachable(): Promise<boolean> {
  if (storeDown()) return false
  try {
    await client.send(new HeadObjectCommand({
      Bucket: config.s3.bucket,
      Key: 'slatehall/health'
    }))
    return true
  } catch (error) {
    // The bucket answering with a missing object means the store is up;
    // a connection failure means it is unreachable.
    const name = (error as { name?: string }).name
    return name === 'NotFound' || name === 'NoSuchKey' || name === '404'
  }
}

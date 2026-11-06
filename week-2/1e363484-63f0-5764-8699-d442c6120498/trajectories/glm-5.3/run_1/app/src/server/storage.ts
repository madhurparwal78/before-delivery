import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import type { Config } from './config.js'

export type Evidence = { readingsKey: string; derivationKey: string }

export class ObjectStore {
  private client: S3Client

  constructor(private cfg: Config) {
    this.client = new S3Client({
      endpoint: cfg.s3.endpoint,
      region: cfg.s3.region,
      forcePathStyle: cfg.s3.forcePathStyle,
      credentials: {
        accessKeyId: cfg.s3.accessKeyId,
        secretAccessKey: cfg.s3.secretAccessKey,
      },
    })
  }

  async ensureBucket(): Promise<void> {
    await this.client.send(new (await import('@aws-sdk/client-s3')).CreateBucketCommand({ Bucket: this.cfg.s3.bucket }))
  }

  private key(figId: string, file: string): string {
    return `figures/${figId}/${file}`
  }

  async putReadings(figId: string, bytes: Buffer, sha256: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: this.key(figId, 'readings.csv'),
      Body: bytes,
      ContentType: 'text/csv',
      Metadata: { sha256 },
    }))
  }

  async putDerivation(figId: string, body: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: this.key(figId, 'derivation.json'),
      Body: body,
      ContentType: 'application/json',
    }))
  }

  /** Confirm both objects: size and sha256 metadata of the readings must match. */
  async confirm(figId: string, expectedSize: number, expectedSha: string): Promise<boolean> {
    const readingsHead = await this.client.send(new HeadObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: this.key(figId, 'readings.csv'),
    }))
    if ((readingsHead.ContentLength ?? -1) !== expectedSize) return false
    if (readingsHead.Metadata?.sha256 !== expectedSha) return false
    await this.client.send(new HeadObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: this.key(figId, 'derivation.json'),
    }))
    return true
  }

  /** Stream the stored readings object, never a regenerated file. */
  async getReadings(figId: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: this.key(figId, 'readings.csv'),
    }))
    const stream = res.Body as Readable
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks)
  }

  async deleteEvidence(figId: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: this.key(figId, 'readings.csv'),
    }))
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: this.key(figId, 'derivation.json'),
    }))
  }
}

// MinIO/S3 object storage. Keyed only under this app's own orgs/<org_id>/... prefix.

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config } from './config';
import { errors } from './errors';

export class Storage {
  private client: S3Client;

  constructor(private cfg: Config) {
    this.client = new S3Client({
      endpoint: cfg.s3.endpoint,
      region: cfg.s3.region,
      forcePathStyle: cfg.s3.forcePathStyle,
      credentials: { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey },
    });
  }

  // A fresh client per operation keeps a configured-but-unreachable endpoint from being cached.
  private freshClient(): S3Client {
    return new S3Client({
      endpoint: this.cfg.s3.endpoint,
      region: this.cfg.s3.region,
      forcePathStyle: this.cfg.s3.forcePathStyle,
      credentials: { accessKeyId: this.cfg.s3.accessKeyId, secretAccessKey: this.cfg.s3.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    try {
      await this.freshClient().send(new PutObjectCommand({ Bucket: this.cfg.s3.bucket, Key: key, Body: body, ContentType: contentType }));
    } catch (e) {
      throw errors.unavailable('storage_unavailable', 'Audio storage is unreachable.');
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      const res = await this.freshClient().send(new GetObjectCommand({ Bucket: this.cfg.s3.bucket, Key: key }));
      const chunks: Buffer[] = [];
      for await (const part of res.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(part));
      return Buffer.concat(chunks);
    } catch (e) {
      const code = (e as { name?: string }).name ?? '';
      if (code === 'NoSuchKey' || code === 'NotFound') throw errors.notFound();
      throw errors.unavailable('storage_unavailable', 'Audio storage is unreachable.');
    }
  }

  async health(): Promise<boolean> {
    try {
      await this.freshClient().send(new GetObjectCommand({ Bucket: this.cfg.s3.bucket, Key: 'lowfield-probe/none' }));
      return true;
    } catch (e) {
      const code = (e as { name?: string }).name ?? '';
      // A 404 from the bucket means storage answers.
      return code === 'NoSuchKey' || code === 'NotFound' || code === 'AccessDenied';
    }
  }

  static sessionKeys(orgId: string, projectId: string, sessionId: string) {
    const base = `orgs/${orgId}/projects/${projectId}/sessions/${sessionId}`;
    return {
      upload: `${base}/upload.wav`,
      sidecar: `${base}/sidecar.vtt`,
      capture: `${base}/capture.pcm`,
      machineTranscript: `${base}/machine-transcript.json`,
    };
  }

  static synthesisKey(orgId: string, projectId: string, jobId: string): string {
    return `orgs/${orgId}/projects/${projectId}/synthesis/${jobId}.wav`;
  }
}

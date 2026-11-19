import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { Config } from "../config/env.js";

/** MinIO through the app's own boundary. Files reach the browser only through the app. */
export class FileStore {
  private client: S3Client;

  constructor(config: Config) {
    this.client = new S3Client({
      region: config.s3Region,
      endpoint: config.s3Endpoint,
      forcePathStyle: config.s3ForcePathStyle,
      credentials: {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
      },
      requestHandler: { requestTimeout: 5000 },
    });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucketOf(process.env.S3_BUCKET ?? "fio-contado"),
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: bucketOf(process.env.S3_BUCKET ?? "fio-contado"), Key: key }),
    );
    const chunks: Buffer[] = [];
    const stream = out.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async remove(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: bucketOf(process.env.S3_BUCKET ?? "fio-contado"), Key: key }),
    );
  }
}

function bucketOf(name: string): string {
  return name;
}

export function evidenceKey(deskId: string, requestId: string, evidenceId: string): string {
  return `evidence/${deskId}/${requestId}/${evidenceId}`;
}

export function dossierKey(deskId: string, dossierId: string): string {
  return `dossiers/${deskId}/${dossierId}.pdf`;
}

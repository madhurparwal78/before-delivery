import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { config } from "./config.js";

const client = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint || undefined,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});

export async function putObject(key: string, body: Buffer, contentType: string): Promise<boolean> {
  try {
    await client.send(new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    return true;
  } catch {
    return false;
  }
}

export async function getObject(key: string): Promise<Buffer | null> {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    const chunks: Buffer[] = [];
    const stream = res.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

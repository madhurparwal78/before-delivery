// MinIO through the AWS SDK. Downloads stream from here; the browser never talks to MinIO.
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
export class FileStorage {
    client;
    bucket;
    constructor(config) {
        this.bucket = config.bucket;
        this.client = new S3Client({
            endpoint: config.endpoint,
            region: config.region,
            forcePathStyle: config.forcePathStyle,
            credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        });
    }
    async put(key, body, contentType) {
        await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    }
    async get(key) {
        const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        return result.Body ?? null;
    }
    async head(key) {
        await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    }
}

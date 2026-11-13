// MinIO (S3) client for prep materials: one object per material record, streamed both ways.
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
export class PrepStorage {
    client;
    bucket;
    constructor(cfg) {
        this.client = new S3Client({
            endpoint: cfg.endpoint,
            region: cfg.region,
            forcePathStyle: cfg.forcePathStyle,
            credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
        });
        this.bucket = cfg.bucket;
    }
    objectKey(bookingId, key) {
        return `prep/${bookingId}/${key}`;
    }
    async put(bookingId, key, bytes, contentType) {
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: this.objectKey(bookingId, key),
            Body: bytes,
            ContentType: contentType,
        }));
    }
    async remove(bookingId, key) {
        await this.client.send(new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: this.objectKey(bookingId, key),
        }));
    }
    /** Fetch the stored object as a stream, releasing promptly when the client leaves. */
    async get(bookingId, key) {
        const res = await this.client.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: this.objectKey(bookingId, key),
        }));
        const stream = res.Body;
        if (!(stream instanceof Readable))
            throw new StorageUnavailable();
        return {
            key,
            stream,
            length: Number(res.ContentLength ?? 0),
        };
    }
}
export class StorageUnavailable extends Error {
    constructor() {
        super('Prep storage is unavailable');
    }
}

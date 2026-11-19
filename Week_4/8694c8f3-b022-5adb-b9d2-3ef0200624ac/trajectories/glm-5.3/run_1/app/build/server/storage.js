import { Client as MinioClient } from 'minio';
// MinIO access goes through one small surface. Every method throws when the
// service is unreachable; callers translate that into storage_unavailable.
export class Storage {
    client;
    bucket;
    reachable = false;
    constructor(options) {
        const url = new URL(options.endpoint);
        this.client = new MinioClient({
            endPoint: url.hostname,
            port: url.port !== '' ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80),
            useSSL: url.protocol === 'https:',
            region: options.region,
            accessKey: options.accessKey,
            secretKey: options.secretKey,
        });
        this.bucket = options.bucket;
        void options.forcePathStyle;
    }
    // putObject followed by a statObject confirmation of size and checksum.
    async store(objectKey, bytes, contentType) {
        await this.client.putObject(this.bucket, objectKey, bytes, bytes.byteLength, { 'Content-Type': contentType });
        const stat = await this.client.statObject(this.bucket, objectKey);
        if (stat.size !== bytes.byteLength) {
            throw new Error('Object size mismatch after write');
        }
    }
    async fetch(objectKey) {
        const stream = await this.client.getObject(this.bucket, objectKey);
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }
    async remove(objectKey) {
        try {
            await this.client.removeObject(this.bucket, objectKey);
        }
        catch {
            // Removing an absent object is already the desired end state.
        }
    }
    async probe() {
        try {
            await this.client.bucketExists(this.bucket);
            this.reachable = true;
        }
        catch {
            this.reachable = false;
        }
        return this.reachable;
    }
    isReachable() {
        return this.reachable;
    }
}
export const objectKeyForAsset = (setId, assetId) => `sets/${setId}/assets/${assetId}`;
export const objectKeyForBundle = (setId, versionNumber) => `sets/${setId}/shows/${versionNumber}/bundle.json`;
export const objectKeyForExport = (setId, exportId) => `sets/${setId}/exports/${exportId}.zip`;
export const objectKeyForImport = (importId) => `imports/${importId}.zip`;

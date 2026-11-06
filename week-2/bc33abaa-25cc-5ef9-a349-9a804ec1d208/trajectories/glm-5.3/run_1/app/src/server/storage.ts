import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import type { Env } from "./env";

export class Storage {
  private client: S3Client | null = null;

  constructor(private env: Env) {}

  private ensure(): S3Client {
    if (!this.client) {
      this.client = new S3Client({
        endpoint: this.env.s3.endpoint,
        region: this.env.s3.region,
        forcePathStyle: this.env.s3.forcePathStyle,
        credentials: { accessKeyId: this.env.s3.accessKeyId, secretAccessKey: this.env.s3.secretAccessKey },
      });
    }
    return this.client;
  }

  async check(): Promise<boolean> {
    try {
      const client = this.ensure();
      await client.send(new HeadBucketCommand({ Bucket: this.env.s3.bucket }));
      return true;
    } catch {
      this.client = null;
      return false;
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const client = this.ensure();
    await client.send(new PutObjectCommand({ Bucket: this.env.s3.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const client = this.ensure();
      const res = await client.send(new GetObjectCommand({ Bucket: this.env.s3.bucket, Key: key }));
      const chunks: Buffer[] = [];
      const stream = res.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  snapshotKey(workspaceId: string, sceneId: string, versionId: string): string {
    return `ws/${workspaceId}/scenes/${sceneId}/versions/${versionId}/snapshot.json`;
  }

  thumbnailKey(workspaceId: string, sceneId: string, versionId: string): string {
    return `ws/${workspaceId}/scenes/${sceneId}/versions/${versionId}/thumbnail.png`;
  }

  assetKey(workspaceId: string, assetId: string): string {
    return `ws/${workspaceId}/assets/${assetId}`;
  }

  publishedKey(workspaceId: string, embedId: string): string {
    return `ws/${workspaceId}/published/${embedId}/scene.json`;
  }

  exportKey(workspaceId: string, exportId: string): string {
    return `ws/${workspaceId}/exports/${exportId}.zip`;
  }

  invoiceKey(workspaceId: string, invoiceId: string): string {
    return `ws/${workspaceId}/invoices/${invoiceId}.pdf`;
  }
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[buf[i]!]! ^ (c >>> 8);
    c >>>= 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal stored (uncompressed) ZIP writer. */
export function makeZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0x21, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0x21, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBuf, end]);
}

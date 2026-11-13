import { Redis } from "ioredis";
import nodemailer from "nodemailer";
import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { config } from "./config.js";

// Each provider reports up or down live; the app never crashes when one is unreachable.

export interface LiveBus {
  publish(channel: string, message: string): Promise<boolean>;
  subscribe(channels: string[]): Promise<boolean>;
  onMessage(handler: (channel: string, message: string) => void): void;
  up(): boolean;
}

const createValkey = (): Redis | null => {
  try {
    const client = new Redis(config.valkeyUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      enableOfflineQueue: false,
    });
    client.on("error", () => {});
    return client;
  } catch {
    return null;
  }
};

export const createServices = () => {
  const redis = createValkey();
  // A separate connection for pub/sub: a subscribed connection cannot run commands.
  const redisSub = createValkey();
  let redisUp = false;
  const localSubs = new Map<string, Set<(message: string) => void>>();

  const connectRedis = async (): Promise<void> => {
    if (!redis) return;
    try {
      if (redis.status !== "ready" && redis.status !== "connecting" && redis.status !== "connect") {
        await redis.connect();
      }
      if (redisSub && redisSub.status !== "ready" && redisSub.status !== "connecting" && redisSub.status !== "connect") {
        await redisSub.connect();
      }
      redisUp = true;
    } catch {
      redisUp = false;
    }
  };
  const s3 = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: config.s3.forcePathStyle,
    credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
  });

  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: false,
    connectionTimeout: 1000,
    greetingTimeout: 1000,
    socketTimeout: 3000,
    tls: { rejectUnauthorized: false },
  });

  const ensureBucket = async (): Promise<boolean> => {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
      return true;
    } catch {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
        return true;
      } catch {
        return false;
      }
    }
  };

  const bus: LiveBus = {
    async publish(channel, message) {
      if (redisUp && redis) {
        try {
          await redis.publish(channel, message);
          return true;
        } catch {
          redisUp = false;
        }
      }
      // Local relay keeps the app working in one process when Valkey is down.
      for (const fn of localSubs.get(channel) ?? []) fn(message);
      return false;
    },
    async subscribe(channels) {
      if (redisUp && redisSub) {
        try {
          await Promise.all(channels.map((c) => redisSub.subscribe(c)));
          return true;
        } catch {
          redisUp = false;
        }
      }
      return false;
    },
    onMessage(handler) {
      if (!redisSub) return;
      redisSub.on("message", (channel: string, message: string) => handler(channel, message));
    },
    up: () => redisUp,
  };

  return {
    bus,
    connectRedis,
    pen: {
      async set(key: string, value: string, ttlMs: number): Promise<boolean> {
        if (redisUp && redis) {
          try {
            await redis.set(key, value, "PX", ttlMs);
            return true;
          } catch {
            redisUp = false;
          }
        }
        memoryPens.set(key, { value, expiresAt: Date.now() + ttlMs });
        return false;
      },
      // Sets the pen only when nobody holds it: exactly one page wins a race.
      async takeIfFree(key: string, value: string, ttlMs: number): Promise<boolean> {
        if (redisUp && redis) {
          try {
            const res = await redis.set(key, value, "PX", ttlMs, "NX");
            return res === "OK";
          } catch {
            redisUp = false;
          }
        }
        const mem = memoryPens.get(key);
        if (mem && mem.expiresAt > Date.now()) return false;
        memoryPens.set(key, { value, expiresAt: Date.now() + ttlMs });
        return true;
      },
      async get(key: string): Promise<string | null> {
        if (redisUp && redis) {
          try {
            const v = await redis.get(key);
            return v;
          } catch {
            redisUp = false;
          }
        }
        const mem = memoryPens.get(key);
        if (mem && mem.expiresAt > Date.now()) return mem.value;
        return null;
      },
      async renew(key: string, value: string, ttlMs: number): Promise<boolean> {
        if (redisUp && redis) {
          try {
            const stored = await redis.get(key);
            if (stored !== value) return false;
            await redis.set(key, value, "PX", ttlMs);
            return true;
          } catch {
            redisUp = false;
          }
        }
        const mem = memoryPens.get(key);
        if (mem && mem.value === value && mem.expiresAt > Date.now()) {
          mem.expiresAt = Date.now() + ttlMs;
          return true;
        }
        return false;
      },
      async delete(key: string): Promise<void> {
        if (redisUp && redis) {
          try {
            await redis.del(key);
          } catch {
            redisUp = false;
          }
        }
        memoryPens.delete(key);
      },
    },
    storage: {
      async put(key: string, body: Buffer, contentType: string): Promise<boolean> {
        try {
          await s3.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType }));
          return true;
        } catch {
          return false;
        }
      },
      async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
        try {
          const res = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
          const chunks: Buffer[] = [];
          for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
          return { body: Buffer.concat(chunks), contentType: res.ContentType ?? "application/octet-stream" };
        } catch {
          return null;
        }
      },
      ensureBucket,
    },
    mail: {
      async send(to: string, subject: string, text: string): Promise<boolean> {
        try {
          await transport.sendMail({ from: config.mailFrom, to, subject, text });
          return true;
        } catch {
          return false;
        }
      },
    },
    async status(): Promise<{ postgres: string; valkey: string; minio: string; mailpit: string }> {
      const [valkey, minio, mailpit] = await Promise.all([
        (async () => {
          if (!redis) return "down";
          try {
            if (redis.status !== "ready" && redis.status !== "connecting" && redis.status !== "connect") {
              await redis.connect();
            }
            const pong = await redis.ping();
            return pong === "PONG" ? "up" : "down";
          } catch {
            return "down";
          }
        })(),
        (async () => {
          try {
            await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
            return "up";
          } catch {
            return "down";
          }
        })(),
        (async () => {
          try {
            await transport.verify();
            return "up";
          } catch {
            return "down";
          }
        })(),
      ]);
      return { postgres: "up", valkey, minio, mailpit };
    },
  };
};

const memoryPens = new Map<string, { value: string; expiresAt: number }>();

export type Services = ReturnType<typeof createServices>;

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { readConfig, type Config } from './config.js';
import { applySchema, connectDatabase, type Db } from './db.js';
import { Storage, StorageUnavailableError } from './storage.js';
import { loadSeed } from './seed.js';
import { ApiError, internalError } from './errors.js';
import { registerRoutes } from './routes.js';
import path from 'node:path';

/** The served public directory, resolved from the working directory. */
export const PUBLIC_DIR = path.join(process.cwd(), 'dist', 'public');

export interface AppContext {
  readonly config: Config;
  readonly db: Db;
  readonly storage: Storage;
}

async function main(): Promise<void> {
  const config = readConfig();
  const db = connectDatabase(config.databaseUrl);
  const storage = new Storage({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    bucket: config.s3Bucket,
    forcePathStyle: config.s3ForcePathStyle,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
  });

  const app = Fastify({
    logger: false,
    bodyLimit: 104857600,
    trustProxy: true,
  });

  // Multipart parsing for photo and CSV uploads, with no default limits: the
  // published per-file limits are checked by the routes themselves.
  await app.register(multipart, { limits: { fileSize: Infinity, files: 1 } });

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  // One error handler: every failure answers in the published error shape,
  // with no library message or internal detail passing through.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      void reply.status(error.status).send(error.body());
      return;
    }
    if (error instanceof StorageUnavailableError) {
      void reply.status(503).send(new ApiError(503, 'storage_unavailable', 'Storage is unavailable right now. Try again later.').body());
      return;
    }
    void reply.status(500).send(internalError().body());
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      void reply.status(404).send(new ApiError(404, 'not_found', 'Not found.').body());
      return;
    }
    void reply.status(404).send('Not found');
  });

  await registerRoutes(app, { config, db, storage });

  // Boot: retry the database until it connects, apply the schema, ensure the
  // bucket exists and load the seed when the profile is missing.
  void (async () => {
    for (;;) {
      try {
        await db`SELECT 1`;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    await applySchema(db);
    await loadSeed(db, config.seed);
    void storage.ensureBucket().catch(() => {
      // MinIO may come up later; degrade only the actions that need it.
    });
  })();

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});

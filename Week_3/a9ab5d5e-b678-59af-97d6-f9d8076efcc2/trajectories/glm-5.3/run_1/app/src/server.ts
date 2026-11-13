/** Twohouse server: schema, seed, workers, listen. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, types } from 'pg';

// DATE columns read as YYYY-MM-DD strings; timestamps stay JS Dates.
types.setTypeParser(1082, (v) => v);
// BIGINT stays a string for exact ids beyond 2^53; amounts are read with Number().
types.setTypeParser(20, (v) => v);
import { loadConfig } from './config';
import { S3 } from './storage/s3';
import { createApiServer } from './server/api';
import { startWorkers } from './server/workers';
import { seedIfEmpty } from './db/seed';
import { withTransaction } from './db/db';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

  // With Postgres unreachable at boot: retry every second until connected.
  for (;;) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Schema and seed apply idempotently on every serve.
  const schema = readFileSync(join(__dirname, 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await withTransaction(pool, async (client) => {
    await seedIfEmpty(client);
  });

  // bucket created idempotently when reachable
  const s3 = new S3({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    bucket: config.s3Bucket,
    forcePathStyle: config.s3ForcePathStyle,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
  });
  s3.ensureBucket().catch(() => undefined);

  const server = createApiServer(config, pool, s3);
  server.listen(config.appPublicPort, '0.0.0.0', () => {
    process.stdout.write(`twohouse listening on ${config.appPublicPort}\n`);
  });

  startWorkers({ config, pool, s3 });
}

void main();

import { config } from './config'
import { createApp } from './app'
import { pool, SCHEMA } from './db'
import { ensureBucket } from './s3'
import { ensureSeed } from './seed'

let ready = false

/** Postgres is retried until it answers; the schema, the seed and the bucket follow. */
async function prepare(): Promise<void> {
  for (;;) {
    try {
      await pool.query(SCHEMA)
      await ensureSeed()
      ready = true
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}

/** An unreachable object store only degrades the actions that need it; the bucket is created when it appears. */
async function keepBucket(): Promise<void> {
  for (;;) {
    try {
      await ensureBucket()
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }
}

createApp(() => ready).listen(config.port, '0.0.0.0')
void prepare()
void keepBucket()

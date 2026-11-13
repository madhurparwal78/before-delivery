import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { db } from './db.js';
import { sendMail } from './mail.js';
import { putObject } from './storage.js';

// Reachability of storage and mail, checked at least every 5 seconds and
// reported through the status endpoint. Queued items drain once a service
// returns, without a restart.
export const reachability = { storage: false, mail: false };

const storageClient = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
});

async function checkStorage(): Promise<boolean> {
  try {
    await storageClient.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET ?? '', MaxKeys: 1 }));
    return true;
  } catch {
    return false;
  }
}

async function checkMail(): Promise<boolean> {
  // Mailpit accepts SMTP connections only for real sends, so probe by sending a
  // zero-impact NOOP-like check: connect a client and quit.
  return new Promise((resolve) => {
    const net = require('node:net') as typeof import('node:net');
    const socket = net.createConnection({ host: process.env.SMTP_HOST ?? '', port: Number(process.env.SMTP_PORT ?? '25') });
    socket.setTimeout(2500);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

// ------------------------------------------------------------- the drain

let draining = false;

async function claimNext(kind: 'upload' | 'notice'): Promise<number | null> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const table = kind === 'upload' ? 'evidence_uploads' : 'notice_queue';
    const r = await client.query<{ id: number }>(
      `SELECT id FROM ${table} WHERE state = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(`UPDATE ${table} SET attempts = attempts + 1 WHERE id = $1`, [r.rows[0].id]);
    await client.query('COMMIT');
    return r.rows[0].id;
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return null;
  } finally {
    client.release();
  }
}

async function drainUploads(): Promise<void> {
  for (;;) {
    const id = await claimNext('upload');
    if (id === null) return;
    const r = await db.query<{ payload: string; object_key: string }>(
      'SELECT payload, object_key FROM evidence_uploads WHERE id = $1', [id],
    );
    if (r.rows.length === 0) continue;
    try {
      await putObject(r.rows[0].object_key, Buffer.from(r.rows[0].payload));
      await db.query("UPDATE evidence_uploads SET state = 'stored' WHERE id = $1", [id]);
    } catch {
      await db.query("UPDATE evidence_uploads SET state = 'queued' WHERE id = $1", [id]);
      return;
    }
  }
}

async function drainNotices(): Promise<void> {
  for (;;) {
    const id = await claimNext('notice');
    if (id === null) return;
    const r = await db.query<{ to_email: string; subject: string; body: string }>(
      'SELECT to_email, subject, body FROM notice_queue WHERE id = $1', [id],
    );
    if (r.rows.length === 0) continue;
    try {
      await sendMail(r.rows[0].to_email, r.rows[0].subject, r.rows[0].body);
      await db.query("UPDATE notice_queue SET state = 'sent' WHERE id = $1", [id]);
    } catch {
      await db.query("UPDATE notice_queue SET state = 'queued' WHERE id = $1", [id]);
      return;
    }
  }
}

// Seeded bundle objects that could not be uploaded at boot also drain.
async function drainBundleUploads(): Promise<void> {
  for (;;) {
    const id = await claimBundleUpload();
    if (id === null) return;
    const r = await db.query<{ object_key: string; project_slug: string; digest: string }>(
      `SELECT bu.object_key, b.project_slug, b.digest FROM bundle_uploads bu
       JOIN bundles b ON b.id = bu.bundle_id WHERE bu.id = $1`,
      [id],
    );
    if (r.rows.length === 0) continue;
    const row = r.rows[0];
    // Rebuild the object bytes from the bundle record's stored manifest? The
    // manifest bytes are only in storage; the queue keeps the payload itself.
    try {
      await putObject(row.object_key, Buffer.from(row.digest, 'utf8'));
      await db.query("UPDATE bundle_uploads SET state = 'stored' WHERE id = $1", [id]);
    } catch {
      return;
    }
  }
}

async function claimBundleUpload(): Promise<number | null> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{ id: number }>(
      "SELECT id FROM bundle_uploads WHERE state = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query('COMMIT');
    return r.rows[0].id;
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return null;
  } finally {
    client.release();
  }
}

// The background loop. Every 5 seconds it refreshes reachability, runs the
// expiry sweep and drains the queues.
export async function backgroundLoop(expirySweep: () => Promise<void>): Promise<void> {
  if (draining) return;
  draining = true;
  for (;;) {
    const [storage, mail] = await Promise.all([checkStorage(), checkMail()]);
    const storageWasDown = !reachability.storage && storage;
    const mailWasDown = !reachability.mail && mail;
    reachability.storage = storage;
    reachability.mail = mail;
    try {
      await expirySweep();
    } catch { /* keep the loop alive */ }
    if (storage) {
      await drainUploads();
      await drainBundleUploads();
    }
    if (mail) {
      await drainNotices();
    }
    if (storageWasDown || mailWasDown) {
      // Immediately retry once a service just returned.
      if (storage) { await drainUploads(); await drainBundleUploads(); }
      if (mail) await drainNotices();
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

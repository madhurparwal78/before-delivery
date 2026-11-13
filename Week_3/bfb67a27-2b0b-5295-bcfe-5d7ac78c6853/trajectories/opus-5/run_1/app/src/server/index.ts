import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { pool, waitForDatabase } from './db.js';
import { applySchemaAndSeed } from './schema.js';
import { handleApiRequest } from './router.js';
import { isKnownPageRoute, pageShell } from './pages.js';
import { sendBytes } from './http.js';
import * as storage from '../providers/storage.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/** Only built assets under the public directory are ever served from disk. */
async function serveAsset(pathname: string): Promise<{ type: string; bytes: Buffer } | null> {
  const extension = Object.keys(ASSET_TYPES).find((candidate) => pathname.endsWith(candidate));
  if (extension === undefined) return null;
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const absolute = join(publicDir, relative);
  if (!absolute.startsWith(publicDir)) return null;
  try {
    return { type: ASSET_TYPES[extension] as string, bytes: await readFile(absolute) };
  } catch {
    return null;
  }
}

const EXPIRY_SWEEP_MS = 2_000;

/** Writes the expired state within the published window of a hold ending. */
function startHoldExpirySweep(): void {
  const sweep = async (): Promise<void> => {
    try {
      await pool.query(
        `UPDATE bookings SET state = 'expired'
          WHERE state = 'quote' AND hold_expires_at <= now()`,
      );
    } catch (error) {
      process.stderr.write(`Hold expiry sweep failed: ${String(error)}\n`);
    }
  };
  setInterval(() => void sweep(), EXPIRY_SWEEP_MS).unref();
  void sweep();
}

async function main(): Promise<void> {
  await waitForDatabase(60_000);
  await applySchemaAndSeed();
  try {
    await storage.ensureBucket();
  } catch (error) {
    process.stderr.write(`Object storage was unreachable at boot: ${String(error)}\n`);
  }
  startHoldExpirySweep();

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApiRequest(req, res, url);
        return;
      }
      const asset = await serveAsset(url.pathname);
      if (asset !== null) {
        sendBytes(res, 200, asset.type, asset.bytes, 'no-cache');
        return;
      }
      const shell = Buffer.from(pageShell(), 'utf8');
      sendBytes(
        res,
        isKnownPageRoute(url.pathname) ? 200 : 404,
        'text/html; charset=utf-8',
        shell,
        'no-cache',
      );
    })().catch((error: unknown) => {
      process.stderr.write(`Request failed: ${String(error)}\n`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Tallyslate listening on 0.0.0.0:${config.port}\n`);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`Tallyslate could not start: ${String(error)}\n`);
  process.exit(1);
});

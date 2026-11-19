import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { applySchema } from './schema.js';
import { q, one } from './db.js';
import { config, readJsonBody } from './http.js';
import { sendError } from './errors.js';
import { now } from './clock.js';
import { registerAuthRoutes } from './auth.js';
import { registerProjectRoutes } from './projects.js';
import { registerDrawingRoutes } from './drawing.js';
import { registerSpriteRoutes } from './spriteRoutes.js';
import { registerPaletteRoutes } from './palettes.js';
import { registerTileRoutes } from './tiles.js';
import { registerJobRoutes } from './jobs.js';
import { registerReviewRoutes } from './review.js';
import { registerUndoRoutes } from './undo.js';
import { registerGradingRoutes } from './grading.js';
import { registerPresenceRoutes } from './presence.js';
import { startOutboxLoop } from './mail.js';
import { storageHealthy, ensureBucket } from './storage.js';
import { startJobLoop, recoverJobs } from './exportJobs.js';
import { seedDemo } from './seed.js';

let dbReady = false;

export async function buildApp(): Promise<Express> {
  const app = express();

  // ---- boundary: same-origin writes, content types, body limits ----
  app.use((req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const method = req.method.toUpperCase();
        const writes = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
        if (writes) {
          const origin = req.headers.origin;
          if (origin) {
            const allowed = config.publicUrl && origin === config.publicUrl
              ? config.publicUrl
              : `${req.protocol}://${req.get('host')}`;
            if (origin !== allowed) {
              res.status(403).json({ error: 'forbidden', message: 'Cross-origin request refused' });
              return;
            }
          }
        }
        const isImport = /^\/api\/projects\/\d+\/imports$/.test(req.path);
        if (['POST', 'PUT', 'PATCH'].includes(method)) {
          const contentType = req.headers['content-type'] ?? '';
          const hasBody = (req.headers['content-length'] ?? '0') !== '0' || req.headers['transfer-encoding'] !== undefined;
          const isJson = contentType.includes('application/json');
          const isMultipart = contentType.includes('multipart/form-data');
          if (hasBody && !isJson && !(isMultipart && isImport)) {
            res.status(415).json({ error: 'unsupported_media_type' });
            return;
          }
          const contentLength = Number(req.headers['content-length'] ?? 0);
          const limit = req.path === '/api/grading/seed' ? 20000000 : 1000000;
          const importLimit = config.importMaxBytes;
          if (Number.isFinite(contentLength) && contentLength > Math.max(limit, isImport ? importLimit : 0)) {
            res.status(413).json({ error: 'too_large' });
            return;
          }
        }
        if (isImport) {
          await readMultipartImport(req, res);
          next();
          return;
        }
        if (isJsonRoute(req.path)) {
          req.body = await readJsonBody(req);
        }
        next();
      } catch (e) {
        if (e instanceof SyntaxError) { res.status(400).json({ error: 'invalid_json' }); return; }
        sendError(res, e);
      }
    })();
  });

  app.get('/api/health', async (_req, res) => {
    let storageOk = false;
    let dbOk = false;
    try {
      await q('select 1');
      dbOk = true;
    } catch { dbOk = false; }
    try { storageOk = await storageHealthy(); } catch { storageOk = false; }
    if (dbOk && storageOk) res.json({ status: 'ok' });
    else res.json({ status: 'unavailable' });
  });

  app.get('/api/config', async (_req, res) => {
    res.json({
      now: await now(),
      palette_max: config.paletteMax,
      sprite_max: config.spriteMax,
      frame_min_ms: config.frameMinMs,
      frame_max_ms: config.frameMaxMs,
      invite_ttl_seconds: config.inviteTtlSeconds,
      long_press_ms: config.longPressMs,
      presence_visible: config.presenceVisible,
      idle_seconds: config.idleSeconds,
      undo_depth: config.undoDepth,
      activity_page: config.activityPage,
      autosave_ms: config.autosaveMs,
      job_item_ms: config.jobItemMs,
      import_max_bytes: config.importMaxBytes
    });
  });

  registerAuthRoutes(app);
  registerProjectRoutes(app);
  registerDrawingRoutes(app);
  registerSpriteRoutes(app);
  registerPaletteRoutes(app);
  registerTileRoutes(app);
  registerJobRoutes(app);
  registerReviewRoutes(app);
  registerUndoRoutes(app);
  registerGradingRoutes(app);
  registerPresenceRoutes(app);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    sendError(res, err);
  });

  // static pages last
  const publicDir = path.resolve('public');
  app.use(express.static(publicDir, { index: false, fallthrough: true }));
  const pagePaths = ['/', '/signup', '/signin', '/projects', '/invites', '/workspace', '/s'];
  app.get('*', (req, res) => {
    // only known page prefixes get the app; anything else is not found
    const isPage = pagePaths.some((p) => req.path === p || req.path.startsWith(`${p}/`));
    const filePath = path.join(publicDir, 'index.html');
    if (isPage && existsSync(filePath)) { res.sendFile(filePath); return; }
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}

function isJsonRoute(p: string): boolean {
  return p.startsWith('/api/') && !/^\/api\/projects\/\d+\/imports$/.test(p);
}

/** Parse the multipart import body: only the `file` part is kept. */
async function readMultipartImport(req: Request, res: Response): Promise<void> {
  const contentType = req.headers['content-type'] ?? '';
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > config.importMaxBytes + 65536) {
      res.status(413).json({ error: 'too_large' });
      return;
    }
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks);
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: { name: string; fileName: string; data: Buffer }[] = [];
  let index = body.indexOf(delimiter);
  while (index !== -1) {
    const start = index + delimiter.length;
    if (body.slice(start, start + 2).toString() === '--') break;
    const headStart = start + 2;
    const headEnd = body.indexOf(Buffer.from('\r\n\r\n'), headStart);
    if (headEnd === -1) break;
    const head = body.slice(headStart, headEnd).toString('utf8');
    const next = body.indexOf(delimiter, headEnd);
    if (next === -1) break;
    const data = body.slice(headEnd + 4, next - 2);
    const nameMatch = /name="([^"]*)"/.exec(head);
    const fileMatch = /filename="([^"]*)"/.exec(head);
    parts.push({ name: nameMatch?.[1] ?? '', fileName: fileMatch?.[1] ?? '', data });
    index = next;
  }
  const file = parts.find((p) => p.name === 'file');
  (req as unknown as { file?: { name: string; data: Buffer } }).file =
    file ? { name: file.fileName, data: file.data } : undefined;
}

export async function start(): Promise<void> {
  const app = await buildApp();
  // schema first; the server listens even when a dependency is unreachable
  const retrySchema = async (): Promise<void> => {
    for (;;) {
      try {
        await applySchema();
        dbReady = true;
        await seedDemo();
        await recoverJobs();
        return;
      } catch (e) {
        console.error('startup step failed:', e instanceof Error ? e.message : e);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };
  void retrySchema();
  void ensureBucket().catch(() => {});
  startOutboxLoop();
  startJobLoop();
  // links ended by the server clock: check every second and notify owners
  setInterval(() => { void endExpiredLinks().catch(() => {}); }, 1000);
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`celmate listening on ${config.port}`);
  });
}

async function endExpiredLinks(): Promise<void> {
  if (!dbReady) return;
  const nowIso = await now();
  const rows = await q<{ id: string; sprite_id: string; label: string; expires_at: string }>(
    `select l.id::text, l.sprite_id::text, l.label, l.expires_at from share_links l
     where l.state = 'active' and l.expires_at is not null and l.expires_at <= $1`,
    [nowIso]
  );
  for (const row of rows) {
    await q('update share_links set state = $1 where id = $2', ['ended', row.id]);
    const sprite = await one<{ name: string; project_id: string }>('select name, project_id::text from sprites where id = $1', [row.sprite_id]);
    if (!sprite) continue;
    const owner = await one<{ id: string; email: string; number_format: string; time_zone: string }>(
      `select u.id::text, u.email, u.number_format, u.time_zone from projects p join memberships m on m.project_id = p.id
       join users u on u.id = m.user_id where p.id = $1 and m.role = 'owner'`,
      [sprite.project_id]
    );
    if (!owner) continue;
    const { queueMail, formatForRecipient } = await import('./mail.js');
    await queueMail(owner.email, `Read-only link ended: ${sprite.name}`,
      `Link: ${row.label}\nEnded: ${formatForRecipient(row.expires_at, owner.number_format, owner.time_zone)}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('start.js')) {
  void start();
}

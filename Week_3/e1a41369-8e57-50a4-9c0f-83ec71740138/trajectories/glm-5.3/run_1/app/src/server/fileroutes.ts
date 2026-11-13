import express from 'express';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  config, requireAuth, q, q1, pool, live, toParty, partyIdOf, emitTasksLive,
  type UserRow, store, loadTask, serializeTaskFor,
} from './kernel.js';
import { ApiError } from './errors.js';
import { parseDeedlist } from './deedlist.js';
import { ObjectStore, detectImageType, IMPORT_MAX_BYTES, BANNER_MAX_BYTES } from './objectstore.js';
import { IMPORT_MAX_BYTES as MAX_IMPORT } from './objectstore.js';

interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

function fileOf(req: Request): UploadedFile | null {
  const files = (req as Request & { files?: Record<string, UploadedFile> }).files;
  return files?.file ?? null;
}

export function registerFileRoutes(app: express.Express): void {
  app.post('/api/imports', requireAuth, async (req, res, next) => {
    try {
      const file = fileOf(req);
      if (!file) {
        res.status(422).json({ errors: { file: 'Choose a .deedlist text file.' } });
        return;
      }
      if (file.size > IMPORT_MAX_BYTES) {
        res.status(413).json({ error: 'file_too_large' });
        return;
      }
      if (!file.originalname.endsWith('.deedlist')) {
        res.status(415).json({ error: 'unsupported_file_type' });
        return;
      }
      // UTF-8 validity and NUL check.
      const text = file.buffer.toString('utf8');
      if (Buffer.from(text, 'utf8').includes('\0') || file.buffer.includes(0)) {
        res.status(415).json({ error: 'unsupported_file_type' });
        return;
      }
      const importId = crypto.randomUUID();
      const key = `imports/${req.user!.id}/${importId}.deedlist`;
      // Store before checking, so "Download original" works for rejected files too.
      try {
        await store.put(key, file.buffer, 'text/plain; charset=utf-8');
      } catch {
        res.status(503).json({ error: 'storage_unavailable' });
        return;
      }
      const { lines, errors } = parseDeedlist(text);
      if (errors.length > 0) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const ins = await client.query<{ id: string; created_at: Date }>(
            `INSERT INTO imports (user_id, filename, size, status, object_key, error_count) VALUES ($1,$2,$3,'rejected',$4,$5) RETURNING id, created_at`,
            [req.user!.id, file.originalname, file.size, key, errors.length]
          );
          for (const e of errors) {
            await client.query(`INSERT INTO import_lines (import_id, line, error) VALUES ($1,$2,$3)`, [
              ins.rows[0].id,
              e.line,
              e.message,
            ]);
          }
          await client.query('COMMIT');
          res.status(422).json({ importId: ins.rows[0].id, errors });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
        return;
      }
      // Create the tasks in file order.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const ins = await client.query<{ id: string; created_at: Date }>(
          `INSERT INTO imports (user_id, filename, size, status, object_key, task_count) VALUES ($1,$2,$3,'imported',$4,$5) RETURNING id, created_at`,
          [req.user!.id, file.originalname, file.size, key, lines.length]
        );
        const importId2 = ins.rows[0].id;
        for (const line of lines) {
          const pos = (
            await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE owner_id=$1 AND type=$2`, [
              req.user!.id,
              line.type,
            ])
          ).rows[0].n;
          const t = await client.query<{ id: string }>(
            `INSERT INTO tasks (owner_id, type, title, difficulty, weekdays, price_cents, position) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [
              req.user!.id,
              line.type,
              line.title,
              line.difficulty,
              line.weekdays ?? null,
              line.price ?? null,
              pos + 1,
            ]
          );
          if (line.checklist) {
            let i = 0;
            for (const item of line.checklist) {
              i += 1;
              await client.query(
                `INSERT INTO checklist_items (task_id, position, text, checked) VALUES ($1,$2,$3,false)`,
                [t.rows[0].id, i, item]
              );
            }
          }
          await client.query(
            `INSERT INTO import_lines (import_id, line, task_id, type, title) VALUES ($1,$2,$3,$4,$5)`,
            [importId2, line.line, t.rows[0].id, line.type, line.title]
          );
        }
        await client.query('COMMIT');
        res.status(201).json(await importBody(req.user!.id, importId2));
        emitTasksLive(req.user!.id);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/imports', requireAuth, async (req, res) => {
    const rows = await q<{ id: string }>(
      `SELECT id FROM imports WHERE user_id=$1 ORDER BY created_at DESC, id`,
      [req.user!.id]
    );
    const out = [];
    for (const r of rows.rows) out.push(await importBody(req.user!.id, r.id));
    res.json({ imports: out });
  });

  app.get('/api/imports/:id', requireAuth, async (req, res) => {
    const row = await q1<{ user_id: string }>(`SELECT user_id FROM imports WHERE id=$1`, [req.params.id]);
    if (!row || row.user_id !== req.user!.id) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(await importBody(req.user!.id, String(req.params.id)));
  });

  app.get('/api/imports/:id/original', requireAuth, async (req, res) => {
    const row = await q1<{ user_id: string; object_key: string; filename: string }>(
      `SELECT user_id, object_key, filename FROM imports WHERE id=$1`,
      [req.params.id]
    );
    if (!row || row.user_id !== req.user!.id) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    try {
      const bytes = await store.get(row.object_key);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${row.filename}"`);
      res.send(bytes);
    } catch {
      res.status(503).json({ error: 'storage_unavailable' });
    }
  });

  app.put('/api/parties/:id/banner', requireAuth, async (req, res, next) => {
    try {
      const partyId = await partyIdOf(req.user!.id);
      if (partyId !== req.params.id) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const party = await toParty(partyId!);
      if (party?.leader !== req.user!.username) {
        res.status(403).json({ error: 'leader_only' });
        return;
      }
      const file = fileOf(req);
      if (!file) {
        res.status(422).json({ errors: { file: 'Choose a PNG or JPEG image.' } });
        return;
      }
      if (file.size > BANNER_MAX_BYTES) {
        res.status(413).json({ error: 'file_too_large' });
        return;
      }
      const type = detectImageType(file.buffer);
      if (!type) {
        res.status(415).json({ error: 'unsupported_file_type' });
        return;
      }
      const uploadId = crypto.randomUUID();
      const ext = type === 'image/png' ? 'png' : 'jpg';
      const key = `banners/${partyId}/${uploadId}.${ext}`;
      try {
        await store.put(key, file.buffer, type);
      } catch {
        res.status(503).json({ error: 'storage_unavailable' });
        return;
      }
      await q(`INSERT INTO banner_uploads (party_id, key, content_type) VALUES ($1,$2,$3)`, [
        partyId,
        key,
        type,
      ]);
      const bannerUrl = `/api/parties/${partyId}/banner?v=${uploadId}`;
      res.status(201).json({ bannerUrl });
      live.toParty(partyId!, 'banner', { partyId, bannerUrl });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/parties/:id/banner', requireAuth, async (req, res) => {
    const partyId = await partyIdOf(req.user!.id);
    if (partyId !== req.params.id) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const banner = await q1<{ key: string; content_type: string }>(
      `SELECT key, content_type FROM banner_uploads WHERE party_id=$1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    if (!banner) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    try {
      const bytes = await store.get(banner.key);
      res.setHeader('Content-Type', banner.content_type);
      res.send(bytes);
    } catch {
      res.status(503).json({ error: 'storage_unavailable' });
    }
  });
}

async function importBody(userId: string, importId: string) {
  const row = await q1<{
    id: string;
    filename: string;
    size: number;
    status: string;
    created_at: Date;
    task_count: number;
    error_count: number;
  }>(`SELECT * FROM imports WHERE id=$1`, [importId]);
  const lines = await q<{ line: number; task_id: string | null; type: string | null; title: string | null; error: string | null }>(
    `SELECT line, task_id, type, title, error FROM import_lines WHERE import_id=$1 ORDER BY line`,
    [importId]
  );
  const errors = lines.rows.filter((l) => l.error !== null).map((l) => ({ line: l.line, message: l.error! }));
  const okLines = lines.rows.filter((l) => l.error === null);
  return {
    id: row!.id,
    filename: row!.filename,
    size: row!.size,
    status: row!.status,
    createdAt: row!.created_at.toISOString(),
    taskCount: row!.task_count,
    errorCount: row!.error_count,
    lines: okLines.map((l) => ({ line: l.line, taskId: l.task_id, type: l.type, title: l.title })),
    errors,
  };
}

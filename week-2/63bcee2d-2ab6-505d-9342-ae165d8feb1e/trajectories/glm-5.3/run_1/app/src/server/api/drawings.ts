// Drawing register: sheet revisions by content, transmittal sets.

import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { one, query, withTransaction } from '../lib/db.js';
import { ApiError, notFound, storageUnavailable, validationError, FIELD_ERRORS } from '../lib/errors.js';
import { requireSession } from '../lib/auth.js';
import type { AuthedRequest } from '../lib/auth.js';
import { scopedProject } from '../lib/scope.js';
import { checkLength, parseMultipart, throwValidation, wrap, withIdempotency } from './helpers.js';
import { buildZip, csvEscape, csvNeutral, detectSheetFile, sha256Hex, svgContainsScript } from '../lib/files.js';
import type { Config } from '../lib/config.js';
import type { Storage } from '../lib/s3.js';
import { STUDIO_ROLES } from '../lib/types.js';

const FILE_LIMIT = 10_000_000;

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // I and O skipped everywhere.

export function nextRevisionLetter(previous: string | null): string {
  if (!previous) return 'A';
  // Increment in base 24 over LETTERS.
  const digits = [...previous].map((ch) => LETTERS.indexOf(ch));
  let i = digits.length - 1;
  while (i >= 0) {
    digits[i] += 1;
    if (digits[i] < LETTERS.length) break;
    digits[i] = 0;
    i -= 1;
  }
  if (i < 0) digits.unshift(0);
  return digits.map((d) => LETTERS[d]).join('');
}

export function drawingsRouter(config: Config, storage: Storage): Router {
  const router = Router();
  router.use('/api', requireSession(config.timing.sessionIdleTimeout));

  const canSeeSheets = (req: AuthedRequest, project: { id: string; contractCompany: string | null; brandId: string; currency: string }): boolean => {
    const member = req.member!;
    if (STUDIO_ROLES.includes(member.role)) return true;
    if (member.role === 'client_approver') return member.brandId === project.brandId;
    if (member.role === 'contractor') return member.companyId === project.contractCompany;
    return false;
  };

  router.get('/api/projects/:id/sheets', wrap(async (req, res) => {
    const project = await scopedProject(req, req.params.id);
    if (!canSeeSheets(req, project)) throw notFound();
    const sheets = await query<{ id: string; code: string; title: string }>(
      'SELECT id, code, title FROM sheets WHERE project_id = $1 ORDER BY code',
      [project.id],
    );
    const result = [];
    for (const sheet of sheets) {
      const revisions = await query<{
        revision: string; state: string; bytes: number; sha256: string; content_type: string;
        original_name: string; note: string | null; uploaded_by: string | null; uploaded_at: Date;
      }>(
        'SELECT revision, state, bytes, sha256, content_type, original_name, note, uploaded_by, uploaded_at FROM sheet_revisions WHERE sheet_id = $1 ORDER BY position',
        [sheet.id],
      );
      result.push({
        id: sheet.id,
        code: sheet.code,
        title: sheet.title,
        currentRevision: revisions.find((r) => r.state === 'current')?.revision ?? null,
        revisions: revisions.map((r) => ({
          revision: r.revision,
          state: r.state,
          bytes: r.bytes,
          sha256: r.sha256,
          contentType: r.content_type,
          originalName: r.original_name,
          note: r.note,
          uploadedBy: r.uploaded_by,
          uploadedAt: r.uploaded_at.toISOString(),
        })),
      });
    }
    res.json({ sheets: result });
  }));

  router.post(
    '/api/projects/:id/sheet-revisions',
    express.raw({ type: 'multipart/form-data', limit: '10100000b' }),
    wrap(async (req, res) => {
      const member = req.member!;
      const project = await scopedProject(req, req.params.id);
      if (!['director', 'project_lead', 'designer'].includes(member.role)) throw new ApiError(403, { error: 'forbidden' });
      const parsed = parseMultipart(req.body as Buffer, req.headers['content-type'] ?? '');
      const file = parsed.files.find((f) => f.fieldName === 'file');
      const sheetCode = (parsed.fields.sheetCode ?? '').toUpperCase();
      const title = parsed.fields.title ?? '';
      const note = parsed.fields.note ?? null;
      const errors: Record<string, string> = {};
      if (!file) errors.file = FIELD_ERRORS.required('File');
      if (file && file.data.length > FILE_LIMIT) errors.file = FIELD_ERRORS.fileTooLarge(file.fileName, FILE_LIMIT);
      if (file && file.data.length > 0) {
        const kind = detectSheetFile(file.data);
        if (!kind) errors.file = FIELD_ERRORS.unsupportedFile(file.fileName);
        else if (kind.kind === 'svg' && svgContainsScript(file.data)) errors.file = FIELD_ERRORS.svgScript(file.fileName);
      }
      const existing = sheetCode ? await one<{ id: string; title: string }>('SELECT id, title FROM sheets WHERE project_id = $1 AND code = $2', [project.id, sheetCode]) : null;
      if (!existing && !title) errors.title = FIELD_ERRORS.required('Title');
      if (title) checkLength(title, 'title', 'Title', 120, errors);
      if (sheetCode && !/^[A-Z0-9-.]{1,20}$/.test(sheetCode)) errors.sheetCode = FIELD_ERRORS.range('Sheet code', '1 and 20 characters');
      if (note) checkLength(note, 'note', 'Note', 500, errors);
      throwValidation(errors);
      if (existing && title && title !== existing.title) {
        await query('UPDATE sheets SET title = $1 WHERE id = $2', [title, existing.id]);
      }
      const kind = detectSheetFile(file!.data)!;
      // Storage first: no register row when storage is unreachable.
      try {
        const sheetId = existing?.id ?? randomUUID();
        if (!existing) {
          await query('INSERT INTO sheets (id, project_id, code, title) VALUES ($1,$2,$3,$4)', [sheetId, project.id, sheetCode, title]);
        }
        const latest = await one<{ revision: string }>(
          'SELECT revision FROM sheet_revisions WHERE sheet_id = $1 ORDER BY position DESC LIMIT 1',
          [sheetId],
        );
        const revision = nextRevisionLetter(latest?.revision ?? null);
        const positionRow = (await one<{ count: string }>('SELECT count(*)::text AS count FROM sheet_revisions WHERE sheet_id = $1', [sheetId]))!;
        const key = `projects/${project.id}/sheets/${sheetCode}/${revision}.${kind.ext}`;
        await storage.put(key, file!.data, kind.contentType);
        await withTransaction(async (client) => {
          await client.query("UPDATE sheet_revisions SET state = 'superseded' WHERE sheet_id = $1 AND state = 'current'", [sheetId]);
          await client.query(
            `INSERT INTO sheet_revisions (id, sheet_id, revision, position, state, bytes, sha256, content_type, original_name, note, uploaded_by)
             VALUES ($1,$2,$3,$4,'current',$5,$6,$7,$8,$9,$10)`,
            [randomUUID(), sheetId, revision, parseInt(positionRow.count, 10) + 1, file!.data.length, sha256Hex(file!.data), kind.contentType, file!.fileName, note, member.id],
          );
        });
        const payload = await sheetPayload(sheetId);
        const revisions = (payload?.revisions ?? []) as { revision: string }[];
        res.status(201).json({ sheet: payload, revision: revisions[revisions.length - 1] });
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw storageUnavailable();
      }
    }),
  );

  router.patch('/api/sheets/:id/revisions/:revision', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (!['director', 'project_lead', 'designer'].includes(member.role)) throw new ApiError(403, { error: 'forbidden' });
    const revisionRow = await one<{ id: string; note: string | null }>(
      'SELECT id, note FROM sheet_revisions WHERE revision = $1 AND sheet_id = $2',
      [req.params.revision, req.params.id],
    );
    if (!revisionRow) throw notFound();
    const sheet = await one<{ project_id: string }>('SELECT project_id FROM sheets WHERE id = $1', [req.params.id]);
    if (!sheet) throw notFound();
    const project = await scopedProject(req, sheet.project_id);
    void project;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const note = typeof body.note === 'string' ? body.note : '';
    if ([...note].length > 500) throw validationError({ note: FIELD_ERRORS.tooLong('Note', 500) });
    const current = await one<{ state: string }>('SELECT state FROM sheet_revisions WHERE id = $1', [revisionRow.id]);
    if (current?.state !== 'current') throw new ApiError(409, { error: 'superseded_read_only' });
    await query('UPDATE sheet_revisions SET note = $1 WHERE id = $2', [note, revisionRow.id]);
    res.json({ revision: { note } });
  }));

  router.get('/api/sheets/:id/revisions/:revision/file', wrap(async (req, res) => {
    const row = await one<{ content_type: string; sha256: string; bytes: number }>(
      'SELECT content_type, sha256, bytes FROM sheet_revisions WHERE revision = $1 AND sheet_id = $2',
      [req.params.revision, req.params.id],
    );
    if (!row) throw notFound();
    const sheet = await one<{ project_id: string; code: string }>('SELECT project_id, code FROM sheets WHERE id = $1', [req.params.id]);
    if (!sheet) throw notFound();
    const project = await scopedProject(req, sheet.project_id);
    // Client approvers and contract-holding contractors can read files.
    const member = req.member!;
    if (!(STUDIO_ROLES.includes(member.role) || member.role === 'client_approver' || member.role === 'contractor')) {
      throw notFound();
    }
    const key = `projects/${project.id}/sheets/${sheet.code}/${req.params.revision}.${extOf(row.content_type)}`;
    try {
      const data = await storage.get(key);
      res.setHeader('Content-Type', row.content_type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (row.content_type === 'image/svg+xml') {
        res.setHeader('Content-Security-Policy', 'sandbox');
      }
      res.send(data);
    } catch {
      throw storageUnavailable();
    }
  }));

  router.post('/api/projects/:id/transmittals', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    const project = await scopedProject(req, req.params.id);
    if (!['director', 'project_lead', 'designer'].includes(member.role)) throw new ApiError(403, { error: 'forbidden' });
    const outcome = await withIdempotency(req, async () => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const purpose = typeof body.purpose === 'string' ? body.purpose : '';
      if (!['for_construction', 'for_tender', 'for_information'].includes(purpose)) {
        throw validationError({ purpose: FIELD_ERRORS.required('Purpose') });
      }
      let targets: { sheetId: string; revision: string }[] | null = null;
      if (Array.isArray(body.sheetRevisions)) {
        targets = (body.sheetRevisions as Record<string, unknown>[]).map((item) => ({
          sheetId: String(item.sheetId ?? ''),
          revision: String(item.revision ?? ''),
        }));
      }
      const allRevisions = await query<{ id: string; sheet_id: string; code: string; revision: string; state: string; bytes: number; sha256: string; content_type: string }>(
        `SELECT sr.id, sr.sheet_id, s.code, sr.revision, sr.state, sr.bytes, sr.sha256, sr.content_type
         FROM sheet_revisions sr JOIN sheets s ON s.id = sr.sheet_id
         WHERE s.project_id = $1 ORDER BY s.code`,
        [project.id],
      );
      let selected: { id: string; sheet_id: string; code: string; revision: string; state: string; bytes: number; sha256: string; content_type: string }[];
      if (targets) {
        selected = [];
        for (const target of targets) {
          const found = allRevisions.find((r) => r.id === target.sheetId && r.revision === target.revision);
          if (!found) throw notFound();
          if (found.state !== 'current') throw validationError({ sheetRevisions: FIELD_ERRORS.supersededInSet });
          selected.push(found);
        }
      } else {
        selected = allRevisions.filter((r) => r.state === 'current');
      }
      if (selected.length === 0) {
        throw validationError({ sheetRevisions: FIELD_ERRORS.required('Sheet revisions') });
      }
      // Build the ZIP: storage first, then one transmittal row.
      const entries: { name: string; data: Buffer }[] = [];
      const manifestRows: string[] = ['sheet,revision,file,bytes,sha256'];
      const fileDatas: { row: (typeof selected)[number]; data: Buffer; ext: string }[] = [];
      try {
        for (const row of selected) {
          const ext = extOf(row.content_type);
          const data = await storage.get(`projects/${project.id}/sheets/${row.code}/${row.revision}.${ext}`);
          fileDatas.push({ row, data, ext });
          entries.push({ name: `${row.code}_${row.revision}.${ext}`, data });
          manifestRows.push(
            [row.code, row.revision, `${row.code}_${row.revision}.${ext}`, row.bytes, row.sha256].map((cell) =>
              typeof cell === 'number' ? String(cell) : csvEscape(csvNeutral(cell)),
            ).join(','),
          );
        }
        const manifest = manifestRows.join('\r\n') + '\r\n';
        entries.push({ name: 'manifest.csv', data: Buffer.from(manifest, 'utf8') });
        const zip = buildZip(entries);
        const numberRow = await one<{ value: string }>(
          "SELECT value FROM counter_state WHERE name = $1",
          [`transmittal_seq_${project.id}`],
        );
        void numberRow;
        const created = await withTransaction(async (client) => {
          const seqRow = await client.query<Record<'value', string>>(
            `INSERT INTO counter_state (name, value) VALUES ($1, 1) ON CONFLICT (name) DO UPDATE SET value = counter_state.value + 1 RETURNING value`,
            [`transmittal_seq_${project.id}`],
          );
          const seq = parseInt(seqRow.rows[0].value, 10);
          const number = `T-${seq.toString().padStart(3, '0')}`;
          const id = randomUUID();
          const zipKey = `projects/${project.id}/transmittals/${number}.zip`;
          return { id, number, seq, zipKey };
        });
        await storage.put(created.zipKey, zip, 'application/zip');
        await withTransaction(async (client) => {
          await client.query(
            'INSERT INTO transmittals (id, project_id, number, seq, purpose, issued_by, zip_bytes, zip_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [created.id, project.id, created.number, created.seq, purpose, member.id, zip.length, sha256Hex(zip)],
          );
          for (const file of fileDatas) {
            await client.query('INSERT INTO transmittal_sheets (transmittal_id, sheet_id, revision) VALUES ($1,$2,$3)', [
              created.id,
              file.row.sheet_id,
              file.row.revision,
            ]);
          }
        });
        return {
          status: 201,
          body: {
            transmittal: {
              id: created.id,
              number: created.number,
              purpose,
              issuedAt: new Date().toISOString(),
              issuedBy: member.id,
              sheets: fileDatas.map((f) => ({ code: f.row.code, revision: f.row.revision, bytes: f.row.bytes, sha256: f.row.sha256 })),
              zipBytes: zip.length,
              zipSha256: sha256Hex(zip),
            },
          },
        };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw storageUnavailable();
      }
    });
    res.status(outcome.status).json(outcome.body);
  }));

  router.get('/api/projects/:id/transmittals', wrap(async (req, res) => {
    const project = await scopedProject(req, req.params.id);
    if (!canSeeSheets(req, project)) throw notFound();
    const rows = await query<{ id: string; number: string; purpose: string; issued_at: Date; zip_bytes: number }>(
      'SELECT id, number, purpose, issued_at, zip_bytes FROM transmittals WHERE project_id = $1 ORDER BY seq DESC',
      [project.id],
    );
    res.json({
      transmittals: rows.map((row) => ({
        id: row.id,
        number: row.number,
        purpose: row.purpose,
        issuedAt: row.issued_at.toISOString(),
        zipBytes: row.zip_bytes,
      })),
    });
  }));

  router.get('/api/transmittals/:id/zip', wrap(async (req, res) => {
    const row = await one<{ project_id: string; number: string }>('SELECT project_id, number FROM transmittals WHERE id = $1', [req.params.id]);
    if (!row) throw notFound();
    const project = await scopedProject(req, row.project_id);
    try {
      const data = await storage.get(`projects/${project.id}/transmittals/${row.number}.zip`);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(data);
    } catch {
      throw storageUnavailable();
    }
  }));

  return router;
}

function extOf(contentType: string): string {
  if (contentType === 'image/svg+xml') return 'svg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  return 'pdf';
}

async function sheetPayload(sheetId: string): Promise<Record<string, unknown> | null> {
  const sheet = await one<{ id: string; code: string; title: string }>('SELECT id, code, title FROM sheets WHERE id = $1', [sheetId]);
  if (!sheet) return null;
  const revisions = await query<{
    revision: string; state: string; bytes: number; sha256: string; content_type: string;
    original_name: string; note: string | null; uploaded_by: string | null; uploaded_at: Date;
  }>('SELECT revision, state, bytes, sha256, content_type, original_name, note, uploaded_by, uploaded_at FROM sheet_revisions WHERE sheet_id = $1 ORDER BY position', [sheetId]);
  return {
    id: sheet.id,
    code: sheet.code,
    title: sheet.title,
    currentRevision: revisions.find((r) => r.state === 'current')?.revision ?? null,
    revisions: revisions.map((r) => ({
      revision: r.revision,
      state: r.state,
      bytes: r.bytes,
      sha256: r.sha256,
      contentType: r.content_type,
      originalName: r.original_name,
      note: r.note,
      uploadedBy: r.uploaded_by,
      uploadedAt: r.uploaded_at.toISOString(),
    })),
  };
}

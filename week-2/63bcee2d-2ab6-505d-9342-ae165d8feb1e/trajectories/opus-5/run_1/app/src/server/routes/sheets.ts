import { createHash } from 'node:crypto';
import { isStudioRole, type TransmittalPurpose } from '../../shared/domain.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { newId } from '../db/ids.js';
import { firstRow, pool, rows, transact, type Queryable } from '../db/pool.js';
import {
  contractorHoldsContract,
  requireProject,
  requireUuid,
  type ProjectRecord,
} from '../domain/access.js';
import { csvDocument, text as csvText, raw as csvRaw } from '../domain/csv.js';
import { revisionLetter } from '../domain/revisions.js';
import { Fields, asArray, asRecord } from '../domain/validate.js';
import { jsonReply, type Reply } from '../http/context.js';
import { conflict, fileTooLarge, notFound, validation } from '../http/errors.js';
import type { Router } from '../http/router.js';
import type { Member } from '../http/session.js';
import {
  baseFileName,
  CONTENT_TYPES,
  detectFileKind,
  EXTENSIONS,
  FILE_LIMIT_BYTES,
  svgCarriesScript,
} from '../services/files.js';
import { getObject, putObject } from '../services/storage.js';
import { buildZip } from '../services/zip.js';
import { withIdempotency } from './idempotency.js';

const SHEET_CODE = /^[A-Z0-9.-]{1,20}$/;

interface RevisionRow {
  id: string;
  sheet_id: string;
  revision: string;
  seq: number;
  state: string;
  bytes: number;
  sha256: string;
  content_type: string;
  original_name: string;
  note: string;
  storage_key: string;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

interface SheetRow {
  id: string;
  code: string;
  title: string;
}

const REVISION_SELECT = `
  SELECT r.id, r.sheet_id, r.revision, r.seq, r.state, r.bytes, r.sha256, r.content_type,
         r.original_name, r.note, r.storage_key, m.name AS uploaded_by_name, r.uploaded_at
    FROM sheet_revisions r LEFT JOIN members m ON m.id = r.uploaded_by`;

function revisionPayload(row: RevisionRow): unknown {
  return {
    revision: row.revision,
    state: row.state,
    bytes: row.bytes,
    sha256: row.sha256,
    contentType: row.content_type,
    originalName: row.original_name,
    note: row.note,
    uploadedBy: row.uploaded_by_name,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
  };
}

/** Sheets are open to studio roles, the brand's approvers and the contract holder. */
async function sheetScope(context: {
  member: () => Promise<Member>;
  param: (name: string) => string;
}): Promise<{ member: Member; project: ProjectRecord }> {
  const member = await context.member();
  const project = await requireProject(pool, context.param('id'), member);
  if (
    member.role === 'contractor' &&
    !(await contractorHoldsContract(pool, project.id, member))
  ) {
    throw notFound();
  }
  return { member, project };
}

async function sheetsOf(client: Queryable, projectId: string): Promise<unknown[]> {
  const sheets = await rows<SheetRow>(
    client,
    'SELECT id, code, title FROM sheets WHERE project_id = $1 ORDER BY code',
    [projectId],
  );
  return Promise.all(
    sheets.map(async (sheet) => {
      const revisions = await rows<RevisionRow>(
        client,
        `${REVISION_SELECT} WHERE r.sheet_id = $1 ORDER BY r.seq`,
        [sheet.id],
      );
      const current = revisions.find((revision) => revision.state === 'current');
      return {
        id: sheet.id,
        code: sheet.code,
        title: sheet.title,
        currentRevision: current?.revision ?? null,
        revisions: revisions.map(revisionPayload),
      };
    }),
  );
}

/** Judges one uploaded file by its content, refusing anything else. */
export function acceptedFile(
  fileName: string,
  bytes: Buffer,
  field = 'file',
): { kind: keyof typeof CONTENT_TYPES; displayName: string } {
  const displayName = baseFileName(fileName);
  if (bytes.byteLength > FILE_LIMIT_BYTES) throw fileTooLarge(FILE_LIMIT_BYTES);
  const kind = detectFileKind(bytes);
  if (!kind) {
    throw validation({ [field]: fieldErrorCopy.unsupportedFile(displayName) });
  }
  if (kind === 'svg' && svgCarriesScript(bytes)) {
    throw validation({ [field]: fieldErrorCopy.svgWithScript(displayName) });
  }
  return { kind, displayName };
}

export function fileHeaders(contentType: string): Record<string, string> {
  return contentType === 'image/svg+xml'
    ? { 'Content-Security-Policy': 'sandbox' }
    : {};
}

async function nextTransmittalNumber(client: Queryable, projectId: string): Promise<string> {
  const row = await firstRow<{ count: number }>(
    client,
    'SELECT COUNT(*)::int AS count FROM transmittals WHERE project_id = $1',
    [projectId],
  );
  return `T-${String((row?.count ?? 0) + 1).padStart(3, '0')}`;
}

interface TransmittalRow {
  id: string;
  number: string;
  purpose: TransmittalPurpose;
  issued_at: string;
  issued_by_name: string | null;
  zip_bytes: number;
  zip_sha256: string;
  storage_key: string;
}

async function transmittalPayload(client: Queryable, row: TransmittalRow): Promise<unknown> {
  const sheets = await rows<{ code: string; revision: string; bytes: number; sha256: string }>(
    client,
    'SELECT code, revision, bytes, sha256 FROM transmittal_sheets WHERE transmittal_id = $1 ORDER BY ord',
    [row.id],
  );
  return {
    id: row.id,
    number: row.number,
    purpose: row.purpose,
    issuedAt: new Date(row.issued_at).toISOString(),
    issuedBy: row.issued_by_name,
    sheets,
    zipBytes: row.zip_bytes,
    zipSha256: row.zip_sha256,
  };
}

const TRANSMITTAL_SELECT = `
  SELECT t.id, t.number, t.purpose, t.issued_at, m.name AS issued_by_name, t.zip_bytes,
         t.zip_sha256, t.storage_key
    FROM transmittals t LEFT JOIN members m ON m.id = t.issued_by`;

export function registerSheetRoutes(router: Router): void {
  router.get('/api/projects/:id/sheets', async (context): Promise<Reply> => {
    const { project } = await sheetScope(context);
    return jsonReply(200, { sheets: await sheetsOf(pool, project.id) });
  });

  router.post('/api/projects/:id/sheet-revisions', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead', 'designer');
    const project = await requireProject(pool, context.param('id'), member);
    const form = await context.multipart();
    const upload = form.files.find((file) => file.field === 'file');
    if (!upload) throw validation({ file: fieldErrorCopy.required('Sheet file') });

    const sheetCode = (form.fields.sheetCode ?? '').toUpperCase();
    const fields = new Fields();
    if (!SHEET_CODE.test(sheetCode)) {
      fields.add('sheetCode', fieldErrorCopy.required('Sheet code'));
    }
    const existingSheet = await firstRow<SheetRow>(
      pool,
      'SELECT id, code, title FROM sheets WHERE project_id = $1 AND code = $2',
      [project.id, sheetCode],
    );
    const title = existingSheet
      ? existingSheet.title
      : fields.text('title', form.fields.title, { label: 'Title', max: 120, oneLine: true });
    const note = fields.text('note', form.fields.note ?? '', {
      label: 'Note',
      min: 0,
      max: 1000,
    });
    fields.finish();

    const accepted = acceptedFile(upload.fileName, upload.bytes);
    const extension = EXTENSIONS[accepted.kind];
    const contentType = CONTENT_TYPES[accepted.kind];
    const sha256 = createHash('sha256').update(upload.bytes).digest('hex');

    const sheetId = existingSheet?.id ?? newId();
    const nextSeq = existingSheet
      ? ((
          await firstRow<{ seq: number }>(
            pool,
            'SELECT COALESCE(MAX(seq), 0) AS seq FROM sheet_revisions WHERE sheet_id = $1',
            [sheetId],
          )
        )?.seq ?? 0) + 1
      : 1;
    const revision = revisionLetter(nextSeq);
    const storageKey = `projects/${project.id}/sheets/${sheetCode}/${revision}.${extension}`;

    await putObject(storageKey, upload.bytes, contentType);

    await transact(async (client) => {
      if (!existingSheet) {
        await client.query(
          'INSERT INTO sheets (id, project_id, code, title) VALUES ($1, $2, $3, $4)',
          [sheetId, project.id, sheetCode, title],
        );
      }
      await client.query(
        `UPDATE sheet_revisions SET state = 'superseded'
          WHERE sheet_id = $1 AND state = 'current'`,
        [sheetId],
      );
      await client.query(
        `INSERT INTO sheet_revisions (id, sheet_id, revision, seq, state, bytes, sha256,
                                      content_type, original_name, note, storage_key, uploaded_by)
         VALUES ($1, $2, $3, $4, 'current', $5, $6, $7, $8, $9, $10, $11)`,
        [
          newId(),
          sheetId,
          revision,
          nextSeq,
          upload.bytes.byteLength,
          sha256,
          contentType,
          accepted.displayName,
          note,
          storageKey,
          member.id,
        ],
      );
    });

    const sheet = (await sheetsOf(pool, project.id)).find(
      (entry) => (entry as { id: string }).id === sheetId,
    );
    const revisionRow = await firstRow<RevisionRow>(
      pool,
      `${REVISION_SELECT} WHERE r.sheet_id = $1 AND r.revision = $2`,
      [sheetId, revision],
    );
    if (!revisionRow) throw notFound();
    return jsonReply(201, { sheet, revision: revisionPayload(revisionRow) });
  });

  router.patch('/api/sheets/:id/revisions/:revision', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead', 'designer');
    const sheetId = requireUuid(context.param('id'));
    const sheet = await firstRow<{ project_id: string }>(
      pool,
      'SELECT project_id FROM sheets WHERE id = $1',
      [sheetId],
    );
    if (!sheet) throw notFound();
    await requireProject(pool, sheet.project_id, member);
    const existing = await firstRow<RevisionRow>(
      pool,
      `${REVISION_SELECT} WHERE r.sheet_id = $1 AND r.revision = $2`,
      [sheetId, context.param('revision')],
    );
    if (!existing) throw notFound();
    if (existing.state === 'superseded') throw conflict('superseded_read_only');

    const body = await context.json();
    const fields = new Fields();
    const note = fields.text('note', body.note ?? '', { label: 'Note', min: 0, max: 1000 });
    fields.finish();

    await pool.query('UPDATE sheet_revisions SET note = $2 WHERE id = $1', [existing.id, note]);
    const after = await firstRow<RevisionRow>(pool, `${REVISION_SELECT} WHERE r.id = $1`, [
      existing.id,
    ]);
    if (!after) throw notFound();
    return jsonReply(200, { revision: revisionPayload(after) });
  });

  router.get('/api/sheets/:id/revisions/:revision/file', async (context): Promise<Reply> => {
    const member = await context.member();
    const sheetId = requireUuid(context.param('id'));
    const sheet = await firstRow<{ project_id: string }>(
      pool,
      'SELECT project_id FROM sheets WHERE id = $1',
      [sheetId],
    );
    if (!sheet) throw notFound();
    const project = await requireProject(pool, sheet.project_id, member);
    if (
      member.role === 'contractor' &&
      !(await contractorHoldsContract(pool, project.id, member))
    ) {
      throw notFound();
    }
    const revision = await firstRow<RevisionRow>(
      pool,
      `${REVISION_SELECT} WHERE r.sheet_id = $1 AND r.revision = $2`,
      [sheetId, context.param('revision')],
    );
    if (!revision) throw notFound();
    const bytes = await getObject(revision.storage_key);
    const kind = detectFileKind(bytes);
    const contentType = kind ? CONTENT_TYPES[kind] : revision.content_type;
    return {
      status: 200,
      bytes,
      contentType,
      headers: fileHeaders(contentType),
    };
  });

  router.post('/api/projects/:id/transmittals', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead', 'designer');
    const project = await requireProject(pool, context.param('id'), member);

    return withIdempotency(context, member, async () => {
      const body = await context.json();
      const fields = new Fields();
      const purpose = fields.enumeration<TransmittalPurpose>('purpose', body.purpose, 'Purpose', [
        'for_construction',
        'for_tender',
        'for_information',
      ]);
      fields.finish();

      const allSheets = await rows<{
        sheet_id: string;
        code: string;
        revision: string;
        state: string;
        bytes: number;
        sha256: string;
        storage_key: string;
        content_type: string;
      }>(
        pool,
        `SELECT r.sheet_id, s.code, r.revision, r.state, r.bytes, r.sha256, r.storage_key,
                r.content_type
           FROM sheet_revisions r JOIN sheets s ON s.id = r.sheet_id
          WHERE s.project_id = $1
          ORDER BY s.code, r.seq`,
        [project.id],
      );

      let chosen = allSheets.filter((entry) => entry.state === 'current');
      if (body.sheetRevisions !== undefined) {
        const requested = asArray(body.sheetRevisions).map((entry) => {
          const record = asRecord(entry);
          return {
            sheetId: typeof record.sheetId === 'string' ? record.sheetId : '',
            revision: typeof record.revision === 'string' ? record.revision : '',
          };
        });
        if (requested.length === 0) {
          throw validation({ sheetRevisions: fieldErrorCopy.required('Sheets') });
        }
        chosen = requested.map((wanted) => {
          const found = allSheets.find(
            (entry) => entry.sheet_id === wanted.sheetId && entry.revision === wanted.revision,
          );
          if (!found) throw validation({ sheetRevisions: fieldErrorCopy.required('Sheets') });
          if (found.state !== 'current') {
            throw validation({ sheetRevisions: fieldErrorCopy.supersededInSet() });
          }
          return found;
        });
      }
      if (chosen.length === 0) {
        throw validation({ sheetRevisions: fieldErrorCopy.required('Sheets') });
      }

      const entries = await Promise.all(
        chosen.map(async (entry) => {
          const bytes = await getObject(entry.storage_key);
          const kind = detectFileKind(bytes);
          const extension = kind ? EXTENSIONS[kind] : 'bin';
          return {
            code: entry.code,
            revision: entry.revision,
            sheetId: entry.sheet_id,
            name: `${entry.code}_${entry.revision}.${extension}`,
            bytes,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          };
        }),
      );

      const manifest = csvDocument(
        ['sheet', 'revision', 'file', 'bytes', 'sha256'],
        entries.map((entry) => [
          csvText(entry.code),
          csvText(entry.revision),
          csvText(entry.name),
          csvRaw(String(entry.bytes.byteLength)),
          csvRaw(entry.sha256),
        ]),
      );

      const zip = buildZip([
        ...entries.map((entry) => ({ name: entry.name, bytes: entry.bytes })),
        { name: 'manifest.csv', bytes: Buffer.from(manifest, 'utf8') },
      ]);

      const transmittalId = newId();
      const number = await nextTransmittalNumber(pool, project.id);
      const storageKey = `projects/${project.id}/transmittals/${number}.zip`;
      await putObject(storageKey, zip, 'application/zip');

      await transact(async (client) => {
        await client.query(
          `INSERT INTO transmittals (id, project_id, number, purpose, issued_by, zip_bytes,
                                     zip_sha256, storage_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            transmittalId,
            project.id,
            number,
            purpose,
            member.id,
            zip.byteLength,
            createHash('sha256').update(zip).digest('hex'),
            storageKey,
          ],
        );
        for (const [index, entry] of entries.entries()) {
          await client.query(
            `INSERT INTO transmittal_sheets (id, transmittal_id, sheet_id, code, revision, bytes,
                                             sha256, ord)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              newId(),
              transmittalId,
              entry.sheetId,
              entry.code,
              entry.revision,
              entry.bytes.byteLength,
              entry.sha256,
              index,
            ],
          );
        }
      });

      const row = await firstRow<TransmittalRow>(pool, `${TRANSMITTAL_SELECT} WHERE t.id = $1`, [
        transmittalId,
      ]);
      if (!row) throw notFound();
      return jsonReply(201, { transmittal: await transmittalPayload(pool, row) });
    });
  });

  router.get('/api/projects/:id/transmittals', async (context): Promise<Reply> => {
    const { project } = await sheetScope(context);
    const found = await rows<TransmittalRow>(
      pool,
      `${TRANSMITTAL_SELECT} WHERE t.project_id = $1 ORDER BY t.number`,
      [project.id],
    );
    return jsonReply(200, {
      transmittals: await Promise.all(found.map((row) => transmittalPayload(pool, row))),
    });
  });

  router.get('/api/transmittals/:id/zip', async (context): Promise<Reply> => {
    const member = await context.member();
    const transmittalId = requireUuid(context.param('id'));
    const row = await firstRow<{ project_id: string; storage_key: string; number: string }>(
      pool,
      'SELECT project_id, storage_key, number FROM transmittals WHERE id = $1',
      [transmittalId],
    );
    if (!row) throw notFound();
    const project = await requireProject(pool, row.project_id, member);
    if (
      member.role === 'contractor' &&
      !(await contractorHoldsContract(pool, project.id, member))
    ) {
      throw notFound();
    }
    return {
      status: 200,
      bytes: await getObject(row.storage_key),
      contentType: 'application/zip',
      headers: { 'Content-Disposition': `attachment; filename="${row.number}.zip"` },
    };
  });
}

import { createHash, randomBytes } from 'node:crypto';
import type { ScanKind } from '../../shared/api.js';
import { barSpanLabel } from '../../shared/format.js';
import { playerMaySeeScan } from '../data/folders.js';
import type { PartRow, ProgrammeAggregate, ScanRow, WorkAggregate } from '../data/programmes.js';
import { loadProgrammeAggregate, programmeIdOfPart, stringCountOf } from '../data/programmes.js';
import { pool, withTransaction } from '../db/pool.js';
import { partPlaysInCut } from '../domain/marking.js';
import { contentDisposition, decodeUploadFileName, fileNameProblem } from '../domain/scan-file-names.js';
import {
  optionalIdempotencyKey,
  requireNotClosed,
  requireRole,
  viewContext,
  visibleProgramme,
} from '../http/access.js';
import type { Person, RequestContext } from '../http/context.js';
import { DESK_ROLES, LIBRARIANS, signedInPerson } from '../http/context.js';
import {
  fileTooLarge,
  forbidden,
  notFound,
  storageUnavailable,
  unsupportedFileType,
  validation,
} from '../http/errors.js';
import { UPLOAD_FILE_LIMIT, sendBytes, sendJson } from '../http/http-io.js';
import { parseMultipart } from '../http/multipart.js';
import { bodyObject, isInteger, isString } from '../http/validate.js';
import { runIdempotent } from '../services/idempotency.js';
import {
  StorageUnavailable,
  confirmScanObject,
  deleteScanObject,
  getScanObject,
  putScanObject,
} from '../services/storage.js';
import { partView, programmeSummaryView, scanView, workSummaryView } from '../view/programme-view.js';

interface LocatedPart {
  aggregate: ProgrammeAggregate;
  work: WorkAggregate;
  part: PartRow;
  partLabel: string;
}

const CUT_RESTORED = 'That cut was restored before the mark was recorded.';

const FILE_SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  'application/pdf': (bytes) => bytes.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/png': (bytes) =>
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (bytes) => bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
};

async function locatePart(context: RequestContext, person: Person): Promise<LocatedPart> {
  const partId = context.params.id ?? '';
  const programmeId = await programmeIdOfPart(pool, partId);
  if (programmeId === null) throw notFound();
  const aggregate = await visibleProgramme(pool, person, programmeId);
  for (const work of aggregate.works) {
    const part = work.parts.find((entry) => entry.id === partId);
    if (part) return { aggregate, work, part, partLabel: `${work.row.title} \u2014 ${part.name}` };
  }
  throw notFound();
}

export async function saveHoldings(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const located = await locatePart(context, person);
  requireRole(person, LIBRARIANS);
  requireNotClosed(located.aggregate);

  const body = bodyObject(context.jsonBody);
  const copiesOnHand = body.copies_on_hand;
  if (!isInteger(copiesOnHand) || copiesOnHand < 0 || copiesOnHand > 99) {
    throw validation({ copies_on_hand: 'Copies on hand must be a whole number from 0 to 99.' });
  }

  const programmeId = located.aggregate.row.id;
  const result = await withTransaction(async (db) => {
    await db.query(`UPDATE parts SET copies_on_hand = $2 WHERE id = $1`, [located.part.id, copiesOnHand]);
    const reloaded = await loadProgrammeAggregate(db, programmeId);
    const work = reloaded?.works.find((entry) => entry.row.id === located.work.row.id);
    const part = work?.parts.find((entry) => entry.id === located.part.id);
    if (!reloaded || !work || !part) throw new Error(`part ${located.part.id} could not be read back`);
    return { reloaded, work, part };
  });

  const stringCount = stringCountOf(result.reloaded.row);
  sendJson(context.response, 200, {
    part: partView(result.work, result.part, stringCount),
    work: workSummaryView(programmeId, result.work, stringCount),
    programme: programmeSummaryView(result.reloaded, await viewContext(pool, context)),
  });
}

export async function recordMark(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const located = await locatePart(context, person);
  const body = bodyObject(context.jsonBody);
  if (!isString(body.cut_id)) throw validation({ cut_id: 'Choose a cut.' });
  const cut = located.work.cuts.find((entry) => entry.id === body.cut_id);
  if (!cut) throw notFound(CUT_RESTORED);

  if (person.role === 'section_principal') {
    if (person.chair?.key !== located.part.chair_key) throw forbidden();
  } else {
    requireRole(person, LIBRARIANS);
  }
  requireNotClosed(located.aggregate);

  if (!partPlaysInCut(located.part, cut)) {
    throw validation({
      cut_id: `${located.partLabel} doesn't play in bars ${barSpanLabel(cut.from_bar, cut.to_bar)}.`,
    });
  }

  const programmeId = located.aggregate.row.id;
  const result = await withTransaction(async (db) => {
    const inserted = await db.query(
      `INSERT INTO marks (part_id, cut_id, marked_by) VALUES ($1, $2, $3)
       ON CONFLICT (part_id, cut_id) DO NOTHING`,
      [located.part.id, cut.id, person.id],
    );
    const reloaded = await loadProgrammeAggregate(db, programmeId);
    const work = reloaded?.works.find((entry) => entry.row.id === located.work.row.id);
    const part = work?.parts.find((entry) => entry.id === located.part.id);
    if (!reloaded || !work || !part) throw new Error(`part ${located.part.id} could not be read back`);
    return {
      created: inserted.rowCount === 1,
      body: { part: partView(work, part, stringCountOf(reloaded.row)) },
    };
  });

  sendJson(context.response, result.created ? 201 : 200, result.body);
}

export async function listScans(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const located = await locatePart(context, person);
  requireRole(person, DESK_ROLES);
  const result = await pool.query<ScanRow>(
    `SELECT s.*, p.name AS uploaded_by_name
       FROM scans s JOIN people p ON p.id = s.uploaded_by
      WHERE s.part_id = $1
      ORDER BY s.filed_at DESC, s.id DESC`,
    [located.part.id],
  );
  sendJson(context.response, 200, { scans: result.rows.map(scanView) });
}

export async function uploadScan(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const multipart = await parseMultipart(context.request.headers['content-type'], context.rawBody);
  const file = multipart.files.find((entry) => entry.fieldName === 'file');

  if (file && file.bytes.length > 0) {
    if (file.bytes.length > UPLOAD_FILE_LIMIT) throw fileTooLarge();
    const matchesSignature = FILE_SIGNATURES[file.contentType];
    if (!matchesSignature || !matchesSignature(file.bytes)) throw unsupportedFileType();
  }

  const located = await locatePart(context, person);
  requireRole(person, DESK_ROLES);

  if (!file || file.bytes.length === 0) {
    throw validation({ file: file ? 'The file is empty.' : 'Choose a file to upload.' });
  }
  const kind = multipart.fields.get('kind');
  if (kind !== 'marked_part' && kind !== 'bowing_master') {
    throw validation({ kind: 'Choose marked_part or bowing_master.' });
  }
  if (kind === 'marked_part') {
    requireRole(person, LIBRARIANS);
  } else if (person.role !== 'section_principal' || person.chair?.key !== located.part.chair_key) {
    throw forbidden();
  }

  const fileName = decodeUploadFileName(file.filenameParameter);
  const problem = fileNameProblem(fileName);
  if (problem !== null) throw validation({ file: problem });

  const sha256 = createHash('sha256').update(file.bytes).digest('hex');
  const key = optionalIdempotencyKey(context);
  const fingerprint = createHash('sha256')
    .update([located.part.id, kind, fileName, sha256].join('\u0000'))
    .digest('hex');
  const programmeId = located.aggregate.row.id;

  const stored = await runIdempotent(`scan:${person.id}`, key, fingerprint, async (db) => {
    const scanId = `sc-${randomBytes(8).toString('hex')}`;
    const objectKey = `scans/${programmeId}/${located.work.row.id}/${located.part.id}/${scanId}`;
    try {
      await putScanObject(objectKey, file.bytes, file.contentType);
      await confirmScanObject(objectKey, file.bytes, sha256);
    } catch (error) {
      if (error instanceof StorageUnavailable) throw storageUnavailable();
      throw error;
    }
    try {
      await db.query(
        `INSERT INTO scans (id, part_id, kind, file_name, content_type, size_bytes, sha256, object_key, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          scanId,
          located.part.id,
          kind,
          fileName,
          file.contentType,
          file.bytes.length,
          sha256,
          objectKey,
          person.id,
        ],
      );
    } catch (error) {
      await deleteScanObject(objectKey).catch(() => undefined);
      throw error;
    }
    const row = await db.query<ScanRow>(
      `SELECT s.*, p.name AS uploaded_by_name FROM scans s JOIN people p ON p.id = s.uploaded_by WHERE s.id = $1`,
      [scanId],
    );
    const scanRow = row.rows[0];
    if (!scanRow) throw new Error(`scan ${scanId} could not be read back`);
    return { status: 201, body: { scan: scanView(scanRow) } };
  });

  sendJson(context.response, stored.status, stored.body);
}

export async function downloadScan(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const scanId = context.params.id ?? '';
  const result = await pool.query<{
    part_id: string;
    kind: ScanKind;
    file_name: string;
    content_type: string;
    object_key: string;
  }>(`SELECT part_id, kind, file_name, content_type, object_key FROM scans WHERE id = $1`, [scanId]);
  const scan = result.rows[0];
  if (!scan) throw notFound();

  if (person.role === 'player') {
    if (!(await playerMaySeeScan(pool, person, scan.part_id, scan.kind))) throw notFound();
  } else {
    requireRole(person, DESK_ROLES);
  }

  try {
    const object = await getScanObject(scan.object_key);
    sendBytes(context.response, 200, object.bytes, {
      'content-type': scan.content_type,
      'content-disposition': contentDisposition(scan.file_name),
      'cache-control': 'no-store',
    });
  } catch (error) {
    if (error instanceof StorageUnavailable) throw storageUnavailable();
    throw error;
  }
}

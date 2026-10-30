// Seeded documents each get a one-page PDF object in MinIO, written on serve
// if missing. Seed objects are written once storage returns.

import { pool } from './db.js';
import { buildPdf } from './pdf.js';
import { putObject, objectExists, documentKey } from './storage.js';

const SEED_DOC_IDS = [
  'doc-rosa-coi',
  'doc-crumb-coi',
  'doc-lake-coi',
  'doc-tomas-card',
  'doc-lena-card',
  'doc-abe-card',
];

export async function writeSeedDocumentPdfs(): Promise<void> {
  for (const id of SEED_DOC_IDS) {
    const q = await pool.query('SELECT member_id, filename FROM documents WHERE id = $1', [id]);
    const row = q.rows[0] as { member_id: string; filename: string } | undefined;
    if (!row) continue;
    const key = documentKey(row.member_id, id);
    if (await objectExists(key)) continue;
    const pdf = buildPdf([
      { text: 'Passboard document', size: 16, bold: true },
      { text: `${id} (${row.filename})`, size: 11 },
      { text: 'Seeded certificate for the Halsted Street Kitchen.', size: 11 },
    ]);
    await putObject(key, pdf, 'application/pdf');
  }
}

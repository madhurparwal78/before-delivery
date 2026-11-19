import pg from 'pg';
import { deflateSync } from 'node:zlib';
import { todayPhoenix, addDays, now, toInstant } from '../domain/time.js';
import { newId } from '../domain/id.js';
import type { Person } from '../domain/types.js';
import { StorageDown, createMultipart, uploadPart, completeMultipart } from '../svc/storage.js';
import { upsertPerson } from '../svc/directory.js';
import { recordLedger } from './ledger.js';
import { broadcast } from './events.js';

interface SeedFileSpec { name: string; contentType: string; locked?: boolean; }
interface SeedFolderSpec { name: string; files: SeedFileSpec[]; }

function pdfBytes(title: string): Buffer {
  const text = title.replace(/[()\\]/g, '');
  const content = `BT /F1 16 Tf 54 760 Td (Lintelworks - Lintel Drive) Tj ET\nBT /F1 11 Tf 54 742 Td (${text}) Tj ET\nBT /F1 9 Tf 54 720 Td (Issued for construction reference.) Tj ET\n0 0 0 RG 0.8 w 36 36 522 720 re S\n0.9 0.9 1 RG 0.5 w 36 60 522 0 m 558 60 l S\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function pngBytes(label: string): Buffer {
  const width = 600, height = 420;
  const pixelSize = Math.ceil((width * 3 + 0) / 4) * 4;
  const raw: number[] = [];
  const line: number[] = [];
  for (let x = 0; x < width; x++) { line.push(0, 0, 0); }
  for (let y = 0; y < height; y++) {
    raw.push(0, ...line);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'latin1');
    const crcInput = Buffer.concat([typeBuf, data]);
    const crc = crc32(crcInput);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(Buffer.from(raw));
  const labelRow = Buffer.from(label, 'latin1');
  const ihdrWithLabel = Buffer.concat([ihdr, labelRow.slice(0, 13)]);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdrWithLabel),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

const CRC_TABLE: Record<number, number> = {};
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = crcLookup((c ^ byte) & 0xff) ^ (c >>> 8);
  }
  return c ^ 0xffffffff;
}

function crcLookup(idx: number): number {
  const v = CRC_TABLE[idx];
  return v === undefined ? 0 : v;
}

const SEED_PEOPLE: Array<{ person: Omit<Person, 'id'>; password: string }> = [
  { person: { name: 'Marisol Okafor', email: 'marisol.okafor@lintelworks.test', firm: 'Lintelworks', kind: 'staff', staffRole: 'engineer' }, password: 'Lintel-demo-2026!' },
  { person: { name: 'Dev Halvorsen', email: 'dev.halvorsen@lintelworks.test', firm: 'Lintelworks', kind: 'staff', staffRole: 'engineer' }, password: 'Lintel-demo-2026!' },
  { person: { name: 'Ines Whitcombe', email: 'ines.whitcombe@lintelworks.test', firm: 'Lintelworks', kind: 'staff', staffRole: 'controller' }, password: 'Lintel-demo-2026!' },
  { person: { name: 'Tomas Achterberg', email: 'tomas.achterberg@lintelworks.test', firm: 'Lintelworks', kind: 'staff', staffRole: 'admin' }, password: 'Lintel-demo-2026!' },
  { person: { name: 'Aiko Brandt', email: 'aiko.brandt@mesquiterow.test', firm: 'Mesquite Row Architects', kind: 'partner', staffRole: null }, password: 'Lintel-demo-2026!' },
  { person: { name: 'Callum Reyes-Tran', email: 'callum.reyes-tran@southerncross-review.test', firm: 'Southern Cross Review', kind: 'partner', staffRole: null }, password: 'Lintel-demo-2026!' },
  { person: { name: 'Rosa Tilden', email: 'rosa.tilden@pimasteel.test', firm: 'Pima Steel Erectors', kind: 'partner', staffRole: null }, password: 'Lintel-demo-2026!' },
];

const SEED_PROJECTS: Array<{ name: string; ownerEmail: string; folders: SeedFolderSpec[] }> = [
  {
    name: '2614 Saguaro Medical Office',
    ownerEmail: 'marisol.okafor@lintelworks.test',
    folders: [
      { name: 'Calculations', files: [{ name: 'Gravity calcs rev B.pdf', contentType: 'application/pdf' }, { name: 'Lateral calcs rev A.pdf', contentType: 'application/pdf' }, { name: 'Wind load summary.pdf', contentType: 'application/pdf' }] },
      { name: 'Drawings', files: [{ name: 'S-101 Foundation Plan.pdf', contentType: 'application/pdf', locked: true }, { name: 'S-201 Second Floor Framing.pdf', contentType: 'application/pdf', locked: true }, { name: 'S-202 Roof Framing.pdf', contentType: 'application/pdf' }, { name: 'S-501 Typical Details.pdf', contentType: 'application/pdf' }, { name: 'S-502 Moment Frame Details.pdf', contentType: 'application/pdf' }] },
      { name: 'Site photos', files: [{ name: 'Footing pour 2026-10-14.png', contentType: 'image/png' }, { name: 'Rebar inspection 2026-10-21.png', contentType: 'image/png' }] },
      { name: 'Issued', files: [{ name: 'IFC Set 2026-10-01.pdf', contentType: 'application/pdf' }, { name: 'Transmittal 2026-10-01.pdf', contentType: 'application/pdf' }] },
      { name: 'Reports', files: [] },
    ],
  },
  {
    name: '2631 Rillito Bridge Retrofit',
    ownerEmail: 'dev.halvorsen@lintelworks.test',
    folders: [
      { name: 'Calculations', files: [{ name: 'Pier capacity check.pdf', contentType: 'application/pdf' }] },
      { name: 'Drawings', files: [{ name: 'B-101 General Arrangement.pdf', contentType: 'application/pdf' }] },
      { name: 'Reports', files: [{ name: 'Condition survey 2026-09.pdf', contentType: 'application/pdf' }] },
    ],
  },
];

export async function seedIfEmpty(client: pg.PoolClient): Promise<boolean> {
  const existing = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM folders');
  if (Number(existing.rows[0]?.count ?? 0) > 0) return false;

  const today = todayPhoenix(now());
  const people = new Map<string, Person>();
  for (const entry of SEED_PEOPLE) {
    const person = await upsertPerson({ ...entry.person, id: '' }, entry.password);
    people.set(person.email, person);
    await client.query(
      'INSERT INTO people (id, email, name, firm, kind, staff_role) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (email) DO UPDATE SET id = EXCLUDED.id, name = EXCLUDED.name, firm = EXCLUDED.firm, kind = EXCLUDED.kind, staff_role = EXCLUDED.staff_role',
      [person.id, person.email, person.name, person.firm, person.kind, person.staffRole],
    );
  }

  const folderIds = new Map<string, string>();
  for (const project of SEED_PROJECTS) {
    const owner = people.get(project.ownerEmail);
    if (!owner) throw new Error('seed owner missing');
    const projectId = newId('fol');
    folderIds.set(`${project.name}/`, projectId);
    await client.query(
      'INSERT INTO folders (id, name, parent_id, project_id, owner_id, created_at) VALUES ($1,$2,NULL,$3,$4,$5)',
      [projectId, project.name, projectId, owner.id, toInstant(now())],
    );
    for (const folderSpec of project.folders) {
      const folderId = newId('fol');
      folderIds.set(`${project.name}/${folderSpec.name}`, folderId);
      await client.query(
        'INSERT INTO folders (id, name, parent_id, project_id, owner_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [folderId, folderSpec.name, projectId, projectId, owner.id, toInstant(now())],
      );
      await client.query(
        'INSERT INTO ledger (id, at, actor_id, actor_name, action, file_id, folder_id, detail) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7)',
        [newId('led'), toInstant(now()), owner.id, owner.name, 'folder_created', folderId, JSON.stringify({ folderName: folderSpec.name })],
      );
      for (const spec of folderSpec.files) {
        await storeSeedFile(client, folderId, spec, owner);
      }
    }
  }

  const binFolderId = folderIds.get('2614 Saguaro Medical Office/Site photos');
  const binFileSpec: SeedFileSpec = { name: 'Old site photo 2026-08-30.png', contentType: 'image/png' };
  const inBinFile = await storeSeedFile(client, binFolderId ?? '', binFileSpec, people.get('marisol.okafor@lintelworks.test')!);
  await client.query(
    'INSERT INTO bin (file_id, from_folder, binned_date, retention_days) VALUES ($1,$2,$3::date,30) ON CONFLICT (file_id) DO NOTHING',
    [inBinFile, binFolderId, today],
  );
  await client.query(
    'UPDATE files SET in_bin = true, binned_date = $2::date, bin_retention_days = 30, bin_from_folder = $3 WHERE id = $1',
    [inBinFile, today, binFolderId],
  );

  const grant = async (personEmail: string, folderKey: string, role: 'viewer' | 'editor', endOffset: number): Promise<void> => {
    const person = people.get(personEmail);
    const itemId = folderIds.get(folderKey);
    if (!person || !itemId) throw new Error('seed grant target missing');
    await client.query(
      'INSERT INTO grants (id, item_type, item_id, person_id, role, end_date, status, created_at) VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8)',
      [newId('grt'), 'folder', itemId, person.id, role, addDays(today, endOffset), 'active', toInstant(now())],
    );
  };

  await grant('aiko.brandt@mesquiterow.test', '2614 Saguaro Medical Office/Drawings', 'editor', 30);
  await grant('callum.reyes-tran@southerncross-review.test', '2614 Saguaro Medical Office/', 'viewer', 60);
  await grant('callum.reyes-tran@southerncross-review.test', '2614 Saguaro Medical Office/Calculations', 'editor', 14);
  await grant('rosa.tilden@pimasteel.test', '2614 Saguaro Medical Office/Issued', 'viewer', 7);
  await grant('rosa.tilden@pimasteel.test', '2631 Rillito Bridge Retrofit/Reports', 'editor', 3);

  await client.query(
    'INSERT INTO policies (id, kind, days, effective_from, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (kind, effective_from) DO NOTHING',
    [newId('pol'), 'bin_retention_days', 30, '2026-01-01', toInstant(now())],
  );
  await client.query(
    'INSERT INTO policies (id, kind, days, effective_from, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (kind, effective_from) DO NOTHING',
    [newId('pol'), 'partner_grant_days', 30, '2026-01-01', toInstant(now())],
  );

  const rillitoProject = folderIds.get('2631 Rillito Bridge Retrofit/');
  const dev = people.get('dev.halvorsen@lintelworks.test')!;
  const marisol = people.get('marisol.okafor@lintelworks.test')!;
  if (rillitoProject) {
    await client.query(
      'INSERT INTO handovers (id, folder_id, from_person, to_person, offered_date, lapse_date, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [newId('hnd'), rillitoProject, dev.id, marisol.id, today, addDays(today, 7), 'offered', toInstant(now())],
    );
    await recordLedger(client, null, 'handover_offered', null, rillitoProject, {
      folderName: '2631 Rillito Bridge Retrofit', toName: marisol.name, lapseDate: addDays(today, 7),
    });
  }
  return true;
}

async function storeSeedFile(client: pg.PoolClient, folderId: string, spec: SeedFileSpec, owner: Person): Promise<string> {
  const fileId = newId('fil');
  const bytes = spec.contentType === 'image/png' ? pngBytes(spec.name) : pdfBytes(spec.name);
  const uploadId = await createMultipart(fileId, spec.contentType);
  try {
    await uploadPart(fileId, uploadId, 1, bytes);
    await completeMultipart(fileId, uploadId);
  } catch (err) {
    if (err instanceof StorageDown) throw err;
    throw err;
  }
  const createdAt = toInstant(now());
  await client.query(
    `INSERT INTO files (id, name, folder_id, size, content_type, modified_at, locked, created_at, purged, in_bin, last_activity)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,false,$6)`,
    [fileId, spec.name, folderId, bytes.length, spec.contentType, createdAt, spec.locked ?? false, createdAt],
  );
  await recordLedger(client, { id: owner.id, name: owner.name }, 'uploaded', fileId, folderId, { fileName: spec.name, folderName: null });
  return fileId;
}

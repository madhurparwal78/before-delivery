import { randomUUID } from 'node:crypto';
import type { SampleBank } from '../../shared/types.js';
import { query } from '../db/pool.js';
import { errors } from '../errors.js';
import { getObject, objectKeys, putObject } from '../services/s3.js';
import { broadcast } from '../services/valkey.js';

interface BankRow {
  id: string;
  file_name: string;
  kind: 'wav' | 'sfz';
  bytes: number;
  staff_id: string;
  root_pitch: string | null;
  object_key: string;
  created_at: Date;
}

const NAME_PATTERN = /^[A-Za-z0-9 ._\-()]+$/;
const ROOT_PATTERN = /^[A-Ga-g](#{1,2}|b{1,2})?-?\d$/;
const SFZ_HEADERS = [
  '<control>',
  '<global>',
  '<master>',
  '<group>',
  '<region>',
  '<curve>',
  '<effect>',
  '<midi>',
];

function bankOf(row: BankRow): SampleBank {
  return {
    id: row.id,
    fileName: row.file_name,
    kind: row.kind,
    bytes: row.bytes,
    staffId: row.staff_id,
    rootPitch: row.root_pitch,
    status: 'loaded',
    createdAt: row.created_at.toISOString(),
  };
}

export function validFileName(fileName: string): boolean {
  if (fileName.length < 1 || fileName.length > 120) return false;
  if (!NAME_PATTERN.test(fileName)) return false;
  if (fileName.includes('..')) return false;
  const lower = fileName.toLowerCase();
  return lower.endsWith('.wav') || lower.endsWith('.sfz');
}

export function validRootPitch(root: string): boolean {
  return ROOT_PATTERN.test(root);
}

function isWav(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WAVE'
  );
}

function isSfz(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index);
      index = end === -1 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    return SFZ_HEADERS.some((header) => text.startsWith(header, index));
  }
  return false;
}

/** The content type is judged from the bytes, not the name. */
export function bankKind(fileName: string, bytes: Buffer): 'wav' | 'sfz' {
  const wantsWav = fileName.toLowerCase().endsWith('.wav');
  if (wantsWav && isWav(bytes)) return 'wav';
  if (!wantsWav && isSfz(bytes)) return 'sfz';
  throw errors.unsupportedType();
}

export async function listBanks(scoreId: string): Promise<SampleBank[]> {
  const rows = await query<BankRow>(
    'select * from banks where score_id = $1 order by created_at desc',
    [scoreId],
  );
  return rows.map(bankOf);
}

/** A bank is recorded only after storage has confirmed the object. */
export async function storeBank(
  scoreId: string,
  fileName: string,
  staffId: string,
  rootPitch: string | null,
  kind: 'wav' | 'sfz',
  bytes: Buffer,
): Promise<SampleBank> {
  const id = `bk-${randomUUID().slice(0, 8)}`;
  const key = objectKeys.bank(scoreId, id, fileName);
  await putObject(key, bytes, kind === 'wav' ? 'audio/wav' : 'text/plain; charset=utf-8');
  const rows = await query<BankRow>(
    `insert into banks (id, score_id, file_name, kind, bytes, staff_id, root_pitch, object_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [id, scoreId, fileName, kind, bytes.length, staffId, rootPitch, key],
  );
  const bank = bankOf(rows[0]!);
  await broadcast.publish(scoreId, { type: 'bank', bank });
  return bank;
}

export async function readBankContent(
  scoreId: string,
  bankId: string,
): Promise<{ bytes: Buffer; kind: 'wav' | 'sfz' } | null> {
  const rows = await query<BankRow>('select * from banks where score_id = $1 and id = $2', [
    scoreId,
    bankId,
  ]);
  const row = rows[0];
  if (!row) throw errors.notFound();
  const bytes = await getObject(row.object_key);
  return bytes === null ? null : { bytes, kind: row.kind };
}

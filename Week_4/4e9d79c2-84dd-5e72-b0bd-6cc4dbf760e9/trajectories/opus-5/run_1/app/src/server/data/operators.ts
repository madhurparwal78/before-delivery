import { inTransaction, makeId, one, query } from '../db.js';
import { copy, paperEndsBefore, paperMissing } from '../copy.js';
import { addDays, formatUkDate, ukDateOf } from '../../domain/time.js';
import { DirectoryOperator, readDirectory } from '../providers/wiremock.js';
import { HireView, lastDayOf } from './hires.js';

export type PaperKind = 'operatorLicence' | 'publicLiabilityCover';
export const PAPER_KINDS: PaperKind[] = ['operatorLicence', 'publicLiabilityCover'];

export const PAPER_LABELS: Record<PaperKind, string> = {
  operatorLicence: 'Operator licence',
  publicLiabilityCover: 'Public liability cover',
};

export const DBS_LABEL = 'Driver DBS check';

export type Paper = { kind: PaperKind; endsOn: string; stored: boolean; objectKey: string | null };

export type Operator = {
  id: string;
  name: string;
  town: string;
  email: string;
  telephone: string;
  sizes: number[];
  listed: boolean;
  papers: Paper[];
  dbsCheckedOn: string | null;
};

type OperatorRow = {
  id: string;
  name: string;
  town: string;
  email: string;
  telephone: string;
  sizes: number[];
  listed: boolean;
  dbs_checked_on: string | null;
};

type PaperRow = { id: string; operator_id: string; kind: PaperKind; ends_on: string; stored: boolean; object_key: string | null };

export async function operatorsOf(deskId: string): Promise<Operator[]> {
  const rows = await query<OperatorRow>(
    'select id, name, town, email, telephone, sizes, listed, dbs_checked_on from operators where desk_id = $1 order by id',
    [deskId],
  );
  const papers = await query<PaperRow>(
    'select id, operator_id, kind, ends_on, stored, object_key from papers where desk_id = $1 order by kind',
    [deskId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    town: row.town,
    email: row.email,
    telephone: row.telephone,
    sizes: row.sizes,
    listed: row.listed,
    dbsCheckedOn: row.dbs_checked_on,
    papers: papers
      .filter((paper) => paper.operator_id === row.id)
      .map((paper) => ({
        kind: paper.kind,
        endsOn: paper.ends_on,
        stored: paper.stored,
        objectKey: paper.object_key,
      })),
  }));
}

export async function operatorOf(deskId: string, id: string): Promise<Operator | null> {
  const operators = await operatorsOf(deskId);
  return operators.find((operator) => operator.id === id) ?? null;
}

/** Reads every provider page; one failing page leaves the list exactly as it was. */
export async function refreshDirectory(deskId: string): Promise<Operator[]> {
  const directory: DirectoryOperator[] = await readDirectory();
  await inTransaction(async (client) => {
    const named = directory.map((operator) => operator.id);
    for (const operator of directory) {
      await client.query(
        `insert into operators (desk_id, id, name, town, email, telephone, sizes, listed)
         values ($1,$2,$3,$4,$5,$6,$7,true)
         on conflict (desk_id, id) do update set name = excluded.name, town = excluded.town,
           email = excluded.email, telephone = excluded.telephone, sizes = excluded.sizes, listed = true`,
        [deskId, operator.id, operator.name, operator.town, operator.email, operator.telephone, JSON.stringify(operator.sizes)],
      );
    }
    await client.query('update operators set listed = false where desk_id = $1 and not (id = any($2::text[]))', [
      deskId,
      named,
    ]);
  });
  return operatorsOf(deskId);
}

const FILE_TYPES: { type: string; matches: (bytes: Buffer) => boolean }[] = [
  { type: 'application/pdf', matches: (bytes) => bytes.subarray(0, 4).toString('latin1') === '%PDF' },
  { type: 'image/jpeg', matches: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  {
    type: 'image/png',
    matches: (bytes) =>
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
  },
];

/** Papers are judged by their first bytes and never their name or stated type. */
export function fileTypeOf(bytes: Buffer): string | null {
  for (const candidate of FILE_TYPES) {
    if (candidate.matches(bytes)) return candidate.type;
  }
  return null;
}

export function paperObjectKey(deskId: string, operatorId: string, kind: PaperKind, paperId: string): string {
  return `desks/${deskId}/operators/${operatorId}/${kind}/${paperId}`;
}

export async function storePaperRecord(
  deskId: string,
  operatorId: string,
  kind: PaperKind,
  endsOn: string,
  objectKey: string | null,
  contentType: string | null,
  paperId: string,
): Promise<void> {
  await query(
    `insert into papers (desk_id, id, operator_id, kind, ends_on, stored, object_key, content_type)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (desk_id, operator_id, kind) do update set ends_on = excluded.ends_on,
       stored = excluded.stored, object_key = excluded.object_key, content_type = excluded.content_type`,
    [deskId, paperId, operatorId, kind, endsOn, objectKey !== null, objectKey, contentType],
  );
}

export async function paperFile(
  deskId: string,
  operatorId: string,
  kind: string,
): Promise<{ objectKey: string; contentType: string } | null> {
  const row = await one<{ object_key: string | null; content_type: string | null }>(
    'select object_key, content_type from papers where desk_id = $1 and operator_id = $2 and kind = $3',
    [deskId, operatorId, kind],
  );
  if (!row?.object_key) return null;
  return { objectKey: row.object_key, contentType: row.content_type ?? 'application/octet-stream' };
}

export type Standing = { clear: boolean; reason: string | null };

/** An operator is Clear only if every required paper covers the hire's last day. */
export function standingFor(operator: Operator, hire: HireView): Standing {
  const lastDay = lastDayOf(hire);
  if (!operator.listed) return { clear: false, reason: copy.noLongerListed };
  for (const kind of PAPER_KINDS) {
    const paper = operator.papers.find((held) => held.kind === kind);
    if (!paper) return { clear: false, reason: paperMissing(PAPER_LABELS[kind]) };
    if (paper.endsOn < lastDay) {
      return { clear: false, reason: paperEndsBefore(PAPER_LABELS[kind], paper.endsOn) };
    }
  }
  if (hire.occasion === 'school') {
    if (!operator.dbsCheckedOn) return { clear: false, reason: copy.dbsMissing };
    const oldest = addDays(lastDay, 0);
    const [year, month, day] = oldest.split('-').map(Number);
    const threeYearsBefore = `${year - 3}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (operator.dbsCheckedOn < threeYearsBefore) return { clear: false, reason: copy.dbsTooOld };
  }
  return { clear: true, reason: null };
}

export type ExpiringPaper = { operatorId: string; operatorName: string; kind: PaperKind; endsOn: string };

/** Papers ending within 30 days, counted on UK dates, 0 to 30 inclusive, not mailed yet. */
export async function papersNeedingExpiryMail(deskId: string, now: number): Promise<ExpiringPaper[]> {
  const today = ukDateOf(now);
  const limit = addDays(today, 30);
  const rows = await query<{ id: string; operator_id: string; kind: PaperKind; ends_on: string; name: string }>(
    `select p.id, p.operator_id, p.kind, p.ends_on, o.name from papers p
     join operators o on o.desk_id = p.desk_id and o.id = p.operator_id
     where p.desk_id = $1 and p.expiry_mailed = false and p.ends_on >= $2 and p.ends_on <= $3`,
    [deskId, today, limit],
  );
  return rows.map((row) => ({
    operatorId: row.operator_id,
    operatorName: row.name,
    kind: row.kind,
    endsOn: row.ends_on,
  }));
}

export async function markExpiryMailed(deskId: string, operatorId: string, kind: PaperKind): Promise<void> {
  await query('update papers set expiry_mailed = true where desk_id = $1 and operator_id = $2 and kind = $3', [
    deskId,
    operatorId,
    kind,
  ]);
}

export function expiryMailSubject(paper: ExpiringPaper): string {
  return `${PAPER_LABELS[paper.kind]} for ${paper.operatorName} ends on ${formatUkDate(paper.endsOn)}`;
}

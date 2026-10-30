import { PoolClient } from 'pg';
import { VersionDto } from '../../shared/api';
import { WorkbookSnapshot, WorkbookState, snapshotOf } from '../../shared/workbook';
import { applyOp } from '../../shared/ops';
import { AuthMember } from '../http/context';
import { apiErrors } from '../http/errors';
import { uuid } from '../secrets';
import { deleteObject, getObject, putObject } from '../services/storage';
import { insertOp, loadWorkbookState, touchWorkbook } from './state';
import { WorkbookRow } from './workbooks';

export type VersionKind = 'saved' | 'restore' | 'before_restore';

export interface VersionRow {
  id: string;
  number: number;
  label: string;
  kind: VersionKind;
  seq: number;
  object_key: string;
  created_at: Date;
  created_by: string;
  author_name: string;
}

export function versionDto(row: VersionRow): VersionDto {
  return {
    id: row.id,
    number: row.number,
    label: row.label,
    kind: row.kind,
    seq: row.seq,
    createdAt: row.created_at.toISOString(),
    createdBy: { id: row.created_by, name: row.author_name },
  };
}

export const VERSION_SQL = `select v.id, v.number, v.label, v.kind, v.seq, v.object_key, v.created_at,
    v.created_by, coalesce(m.name, 'A removed member') as author_name
  from versions v left join members m on m.id = v.created_by`;

function versionKey(stationId: string, workbookId: string, number: number): string {
  return `stations/${stationId}/workbooks/${workbookId}/versions/${number}.json`;
}

/** A saved version exists only if its snapshot was stored first. */
async function writeVersion(
  client: PoolClient,
  row: WorkbookRow,
  member: AuthMember,
  params: { label: string; kind: VersionKind; state: WorkbookState; seq: number },
  storedKeys: string[],
): Promise<VersionDto> {
  const next = (
    await client.query('select coalesce(max(number), 0) + 1 as number from versions where workbook_id = $1', [row.id])
  ).rows[0] as { number: number };
  const number = Number(next.number);
  const key = versionKey(row.station_id, row.id, number);
  const snapshot = snapshotOf(params.state);
  await putObject(key, Buffer.from(JSON.stringify({ seq: params.seq, ...snapshot }), 'utf8'), 'application/json');
  storedKeys.push(key);
  const id = uuid();
  const inserted = (
    await client.query(
      `insert into versions (id, workbook_id, number, label, kind, seq, object_key, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id, number, label, kind, seq, object_key, created_at, created_by`,
      [id, row.id, number, params.label, params.kind, params.seq, key, member.id],
    )
  ).rows[0] as Omit<VersionRow, 'author_name'>;
  return versionDto({ ...inserted, author_name: member.name });
}

export async function saveVersion(
  client: PoolClient,
  row: WorkbookRow,
  member: AuthMember,
  label: string,
  storedKeys: string[],
): Promise<VersionDto> {
  const { state, headSeq } = await loadWorkbookState(row.id, client);
  return writeVersion(client, row, member, { label, kind: 'saved', state, seq: headSeq }, storedKeys);
}

export interface RestoreOutcome {
  restored: VersionDto;
  undo: VersionDto;
  headSeq: number;
}

/** Restoring saves the current state first, so the restore itself can be undone exactly. */
export async function restoreVersion(
  client: PoolClient,
  row: WorkbookRow,
  member: AuthMember,
  versionId: string,
  storedKeys: string[],
): Promise<RestoreOutcome> {
  const target = (
    await client.query(`${VERSION_SQL} where v.id = $1 and v.workbook_id = $2`, [versionId, row.id])
  ).rows[0] as VersionRow | undefined;
  if (!target) throw apiErrors.notFound();
  const stored = JSON.parse((await getObject(target.object_key)).toString('utf8')) as WorkbookSnapshot;
  const snapshot: WorkbookSnapshot = { sheets: stored.sheets, charts: stored.charts };

  const { state, headSeq } = await loadWorkbookState(row.id, client);
  const undo = await writeVersion(
    client,
    row,
    member,
    { label: `Before restoring version ${target.number}`, kind: 'before_restore', state, seq: headSeq },
    storedKeys,
  );

  const seq = headSeq + 1;
  const op = { type: 'restore' as const, snapshot };
  await insertOp(client, row.id, seq, member.id, op);
  applyOp(state, op, seq, member.id);
  await touchWorkbook(client, row.id, seq);

  const restored = await writeVersion(
    client,
    row,
    member,
    { label: `Restored version ${target.number}`, kind: 'restore', state, seq },
    storedKeys,
  );
  return { restored, undo, headSeq: seq };
}

export async function discardStoredVersions(keys: string[]): Promise<void> {
  for (const key of keys) await deleteObject(key).catch(() => undefined);
}

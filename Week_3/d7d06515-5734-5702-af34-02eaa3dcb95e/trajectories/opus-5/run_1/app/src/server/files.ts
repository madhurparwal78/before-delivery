import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FileItem } from '../shared/api';
import { copy } from '../shared/copy';
import { formatDateTime, formatFileSize, type Units } from '../shared/format';
import type { WorkspaceRecord } from './clock';
import { one, query } from './db';
import { invalid, ValidationError } from './errors';

const FORBIDDEN_NAME_CHARACTERS = /[/\\:*?"<>|]/;

export function checkFolderName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80 || FORBIDDEN_NAME_CHARACTERS.test(trimmed)) {
    invalid('name', copy.files.folderNameError);
  }
  return trimmed;
}

/** File names are checked, then given `.dxf` when missing. */
export function checkFileName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80 || FORBIDDEN_NAME_CHARACTERS.test(trimmed)) {
    invalid('name', copy.files.fileNameError);
  }
  return trimmed.toLowerCase().endsWith('.dxf') ? trimmed : `${trimmed}.dxf`;
}

export function duplicateFolderName(name: string): ValidationError {
  return new ValidationError({ name: copy.files.folderNameTaken(name) });
}

export function duplicateFileName(name: string): ValidationError {
  return new ValidationError({ name: copy.files.fileNameTaken(name) });
}

export interface FolderRecord {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  kind: 'root' | 'samples' | 'normal';
  modified_at: Date;
  created_at: Date;
}

export async function findFolder(id: string): Promise<FolderRecord | null> {
  return await one<FolderRecord>('select * from folders where id = $1', [id]);
}

export async function touchFolder(folderId: string, now: Date): Promise<void> {
  await query('update folders set modified_at = $2 where id = $1', [folderId, now]);
}

export async function touchDrawing(drawingId: string, now: Date): Promise<void> {
  await query('update drawings set modified_at = $2 where id = $1', [drawingId, now]);
}

export type SortKey = 'type' | 'name' | 'modified' | 'size' | 'owner' | 'shared';

const DEFAULT_DESCENDING: Record<SortKey, boolean> = {
  type: false,
  name: false,
  modified: true,
  size: false,
  owner: false,
  shared: false,
};

export function isSortKey(value: string): value is SortKey {
  return Object.prototype.hasOwnProperty.call(DEFAULT_DESCENDING, value);
}

interface RawItem {
  id: string;
  kind: 'folder' | 'drawing';
  name: string;
  modified_at: Date;
  size_bytes: number | null;
  is_sample: boolean;
  shared: boolean;
}

export async function folderItems(folderId: string): Promise<RawItem[]> {
  const folders = await query<{ id: string; name: string; modified_at: Date }>(
    "select id, name, modified_at from folders where parent_id = $1 and kind = 'normal'",
    [folderId],
  );
  const drawings = await query<{
    id: string;
    name: string;
    modified_at: Date;
    is_sample: boolean;
    size_bytes: number | null;
    shared: boolean;
  }>(
    `select d.id, d.name, d.modified_at, d.is_sample,
       (select fv.size_bytes from file_versions fv where fv.drawing_id = d.id order by fv.number desc limit 1) as size_bytes,
       exists (select 1 from shares s where s.drawing_id = d.id and s.revoked_at is null) as shared
     from drawings d where d.folder_id = $1`,
    [folderId],
  );
  return [
    ...folders.map((row) => ({
      id: row.id,
      kind: 'folder' as const,
      name: row.name,
      modified_at: row.modified_at,
      size_bytes: null,
      is_sample: false,
      shared: false,
    })),
    ...drawings.map((row) => ({
      id: row.id,
      kind: 'drawing' as const,
      name: row.name,
      modified_at: row.modified_at,
      size_bytes: row.size_bytes,
      is_sample: row.is_sample,
      shared: row.shared,
    })),
  ];
}

/** Folders always come before files, then the requested sort applies, ties by name A to Z. */
export function sortItems(items: RawItem[], sort: SortKey, order: 'asc' | 'desc'): RawItem[] {
  const descending = order === 'desc';
  const typeRank = (item: RawItem): number => (item.kind === 'folder' ? 0 : 1);
  const keyOf = (item: RawItem): string | number => {
    switch (sort) {
      case 'name':
        return item.name.toLowerCase();
      case 'modified':
        return item.modified_at.getTime();
      case 'size':
        return item.size_bytes ?? -1;
      case 'owner':
        return item.is_sample ? copy.files.ownerSamples : copy.files.ownerSelf;
      case 'shared':
        return item.shared ? copy.files.sharedYes : copy.files.dash;
      case 'type':
        return item.kind;
    }
  };
  return [...items].sort((a, b) => {
    const byType = typeRank(a) - typeRank(b);
    if (byType !== 0) return byType;
    const left = keyOf(a);
    const right = keyOf(b);
    let comparison = 0;
    if (typeof left === 'number' && typeof right === 'number') comparison = left - right;
    else comparison = String(left).localeCompare(String(right));
    if (comparison !== 0) return descending ? -comparison : comparison;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

export function defaultOrder(sort: SortKey): 'asc' | 'desc' {
  return DEFAULT_DESCENDING[sort] ? 'desc' : 'asc';
}

export function serializeItems(items: RawItem[], workspace: WorkspaceRecord): FileItem[] {
  return items.map((item) => ({
    id: item.id,
    kind: item.kind,
    name: item.name,
    modified_at: item.modified_at.toISOString(),
    modified_label: formatDateTime(item.modified_at, workspace.time_zone),
    size_bytes: item.size_bytes,
    size_label:
      item.kind === 'folder' || item.size_bytes === null ? copy.files.dash : formatFileSize(item.size_bytes),
    owner: item.is_sample ? copy.files.ownerSamples : copy.files.ownerSelf,
    shared: item.shared ? copy.files.sharedYes : copy.files.dash,
  }));
}

export interface FileVersionRecord {
  drawing_id: string;
  number: number;
  created_at: Date;
  actor: string;
  size_bytes: number;
  object_key: string;
}

export async function listFileVersions(drawingId: string): Promise<FileVersionRecord[]> {
  return await query<FileVersionRecord>(
    'select * from file_versions where drawing_id = $1 order by number desc',
    [drawingId],
  );
}

export async function nextFileVersionNumber(drawingId: string): Promise<number> {
  const rows = await query<{ next: number }>(
    'select coalesce(max(number), 0) + 1 as next from file_versions where drawing_id = $1',
    [drawingId],
  );
  return rows[0]?.next ?? 1;
}

export function fileVersionKey(drawingId: string, number: number): string {
  return `drawings/${drawingId}/v${number}.dxf`;
}

export async function insertFileVersion(
  client: PoolClient,
  record: FileVersionRecord,
): Promise<void> {
  await client.query(
    `insert into file_versions (drawing_id, number, created_at, actor, size_bytes, object_key)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      record.drawing_id,
      record.number,
      record.created_at,
      record.actor,
      record.size_bytes,
      record.object_key,
    ],
  );
}

export async function recordOpen(userId: string, drawingId: string, now: Date): Promise<void> {
  await query(
    `insert into recent_opens (user_id, drawing_id, opened_at) values ($1,$2,$3)
     on conflict (user_id, drawing_id) do update set opened_at = excluded.opened_at`,
    [userId, drawingId, now],
  );
}

export async function recentItems(userId: string, workspace: WorkspaceRecord): Promise<FileItem[]> {
  const rows = await query<{
    id: string;
    name: string;
    modified_at: Date;
    is_sample: boolean;
    size_bytes: number | null;
    shared: boolean;
  }>(
    `select d.id, d.name, d.modified_at, d.is_sample,
       (select fv.size_bytes from file_versions fv where fv.drawing_id = d.id order by fv.number desc limit 1) as size_bytes,
       exists (select 1 from shares s where s.drawing_id = d.id and s.revoked_at is null) as shared
     from recent_opens r join drawings d on d.id = r.drawing_id
     where r.user_id = $1 order by r.opened_at desc limit 10`,
    [userId],
  );
  return serializeItems(
    rows.map((row) => ({
      id: row.id,
      kind: 'drawing' as const,
      name: row.name,
      modified_at: row.modified_at,
      size_bytes: row.size_bytes,
      is_sample: row.is_sample,
      shared: row.shared,
    })),
    workspace,
  );
}

export function newDrawingId(): string {
  return crypto.randomUUID();
}

export function unitsOf(value: unknown, fallback: Units): Units {
  return value === 'm' || value === 'mm' ? value : fallback;
}

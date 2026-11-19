import { db, type Queryable } from '../db.js';
import { daysBetween, today } from './clock.js';
import { config } from '../config.js';
import type { AccessView } from './access.js';
import type {
  BinRow,
  FileRow,
  FolderRow,
  GrantRow,
  HandoverRow,
  LedgerRow,
  PolicyRow,
  UploadRow,
} from './rows.js';
import type {
  BinItem,
  FileItem,
  Folder,
  Grant,
  Handover,
  LedgerDetail,
  LedgerEntry,
  Person,
  Policy,
  Upload,
} from '../../shared/types.js';
import { PART_SIZE } from '../../shared/types.js';
import { HIDDEN_FOLDER_NAME } from '../../shared/copy.js';

export const PREVIEWABLE = new Set(['image/png', 'image/jpeg', 'application/pdf']);

const PARTNER_LEDGER_ACTIONS = new Set(['uploaded', 'renamed', 'moved', 'locked', 'unlocked']);

export interface SerializeContext {
  view: AccessView;
  counts: Map<string, number>;
  people: Map<string, Person>;
}

export const liveCounts = async (tx: Queryable = db): Promise<Map<string, number>> => {
  const { rows } = await tx.query<{ folder_id: string; n: number }>(
    `SELECT folder_id, count(*)::bigint AS n FROM files WHERE state = 'live' GROUP BY folder_id`,
  );
  return new Map(rows.map((row) => [row.folder_id, row.n]));
};

export const serializeContext = async (
  view: AccessView,
  tx: Queryable = db,
): Promise<SerializeContext> => {
  const counts = await liveCounts(tx);
  const { rows } = await tx.query<{
    id: string;
    name: string;
    email: string;
    firm: string;
    kind: string;
    staff_role: string | null;
  }>('SELECT * FROM directory_cache');
  const people = new Map<string, Person>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        email: row.email,
        firm: row.firm,
        kind: row.kind === 'partner' ? 'partner' : 'staff',
        staffRole: row.staff_role as Person['staffRole'],
      },
    ]),
  );
  return { view, counts, people };
};

export const personRef = (
  context: SerializeContext,
  id: string | null,
): { id: string; name: string } => {
  if (id === null) return { id: '', name: 'Lintel Drive' };
  const person = context.people.get(id);
  return { id, name: person?.name ?? 'Lintel Drive' };
};

export const serializeFolder = (context: SerializeContext, row: FolderRow): Folder => {
  const access = context.view.folderAccess(row.id);
  if (access === null) throw new Error('serializing a folder the caller cannot see');
  const project = context.view.projectOf(row.id);
  const parent = context.view.folderRef(row.parent_id);
  const projectRef =
    project === null || project.id === row.id ? null : context.view.folderRef(project.id).id;
  return {
    id: row.id,
    name: row.name,
    parentId: parent.id,
    projectId: project !== null && project.id === row.id ? row.id : projectRef,
    owner: personRef(context, context.view.ownerIdOf(row.id)),
    fileCount: context.counts.get(row.id) ?? 0,
    access,
  };
};

export const serializeFile = (context: SerializeContext, row: FileRow): FileItem => {
  const access = context.view.fileAccess(row);
  if (access === null) throw new Error('serializing a file the caller cannot see');
  const folder = context.view.folderRef(row.folder_id);
  return {
    id: row.id,
    name: row.name,
    folderId: folder.id,
    folderName: folder.name,
    size: row.size,
    contentType: row.content_type,
    modifiedAt: row.modified_at.toISOString(),
    locked: row.locked,
    access,
    previewable: PREVIEWABLE.has(row.content_type),
    accessEnds: context.view.accessEndsFor(row),
  };
};

export const serializeGrant = (
  context: SerializeContext,
  row: GrantRow,
  itemName: string,
): Grant => {
  const person = context.people.get(row.person_id);
  return {
    id: row.id,
    itemType: row.item_type,
    itemId: row.item_id,
    itemName,
    person: {
      id: row.person_id,
      name: person?.name ?? '',
      firm: person?.firm ?? '',
    },
    role: row.role,
    endDate: row.end_date,
    daysLeft: daysBetween(today(), row.end_date),
    status: row.status,
    endedReason: (row.ended_reason as Grant['endedReason']) ?? null,
  };
};

export const serializeBinItem = (
  context: SerializeContext,
  bin: BinRow,
  file: FileRow,
  purgePending: boolean,
): BinItem => ({
  file: serializeFile(context, file),
  fromFolder: {
    id: bin.from_folder_id,
    name: context.view.folder(bin.from_folder_id)?.name ?? HIDDEN_FOLDER_NAME,
  },
  binnedDate: bin.binned_date,
  retentionDays: bin.retention_days,
  purgeDate: bin.purge_date,
  daysLeft: daysBetween(today(), bin.purge_date),
  purgePending,
});

export const serializeUpload = (row: UploadRow): Upload => ({
  id: row.id,
  folderId: row.folder_id,
  name: row.name,
  size: row.size,
  contentType: row.content_type,
  state: row.state,
  partSize: PART_SIZE,
  partCount: Math.max(1, Math.ceil(row.size / PART_SIZE)),
  confirmedParts: row.parts.map((part) => part.partNumber).sort((a, b) => a - b),
  expiresAt:
    row.state === 'started' || row.state === 'uploading' || row.state === 'paused'
      ? new Date(
          row.last_activity_at.getTime() + config.uploadPauseTtlSeconds * 1000,
        ).toISOString()
      : null,
});

export const serializeHandover = (
  context: SerializeContext,
  row: HandoverRow,
): Handover => ({
  id: row.id,
  folder: {
    id: row.folder_id,
    name: context.view.folder(row.folder_id)?.name ?? HIDDEN_FOLDER_NAME,
  },
  from: personRef(context, row.from_id),
  to: personRef(context, row.to_id),
  offeredDate: row.offered_date,
  lapseDate: row.lapse_date,
  status: row.status,
});

export const serializePolicy = (row: PolicyRow, inForceId: string | null): Policy => ({
  id: row.id,
  kind: row.kind,
  days: row.days,
  effectiveFrom: row.effective_from,
  state:
    row.id === inForceId ? 'in_force' : row.effective_from > today() ? 'scheduled' : 'past',
});

const hideFolderNames = (context: SerializeContext, detail: LedgerDetail): LedgerDetail => {
  const out: LedgerDetail = { ...detail };
  if (detail.fromFolderId !== undefined) {
    const ref = context.view.folderRef(detail.fromFolderId ?? null);
    out.fromFolderId = ref.id;
    out.fromFolderName = ref.name;
  }
  if (detail.toFolderId !== undefined) {
    const ref = context.view.folderRef(detail.toFolderId ?? null);
    out.toFolderId = ref.id;
    out.toFolderName = ref.name;
  }
  return out;
};

export const serializeLedgerEntry = (
  context: SerializeContext,
  row: LedgerRow,
): LedgerEntry | null => {
  if (!context.view.isStaff) {
    if (row.file_id === null || !PARTNER_LEDGER_ACTIONS.has(row.action)) return null;
  }
  const detail = hideFolderNames(context, row.detail as LedgerDetail);
  const folder = row.folder_id === null ? null : context.view.folderRef(row.folder_id);
  return {
    id: row.id,
    at: row.at.toISOString(),
    actor: row.actor_id === null ? null : personRef(context, row.actor_id),
    action: row.action as LedgerEntry['action'],
    fileId: row.file_id,
    folderId: folder?.id ?? null,
    detail,
  };
};

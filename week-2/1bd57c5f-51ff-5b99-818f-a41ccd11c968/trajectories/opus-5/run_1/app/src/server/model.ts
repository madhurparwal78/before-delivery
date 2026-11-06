import {
  type ConflictField,
  type ItemStatus,
  type JobRole,
  type JobStatus,
  type PinStatus,
  type Trade,
} from '../shared/domain.js';
import type { Queryable, Row } from './db.js';
import {
  anchorOf,
  anchorToFraction,
  boundsOf,
  type Bounds,
  insideOutline,
  type Outline,
  PLAN_UNITS,
  type UPoint,
  unitsToFraction,
} from './core/geometry.js';
import { formatMoney, formatQuantity, lineTotal } from './core/money.js';
import type { NoteDoc } from './core/notes.js';

export type PersonRecord = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isOwner: boolean;
};

export type MemberRecord = {
  id: string;
  jobId: string;
  personId: string;
  role: JobRole;
  trade: Trade | null;
  active: boolean;
  name: string;
  email: string;
  phone: string | null;
};

export type JobRecord = {
  id: string;
  firmId: string;
  name: string;
  address: string;
  timeZone: string;
  status: JobStatus;
  createdAt: Date;
};

export type RoomRecord = {
  id: string;
  jobId: string;
  name: string;
  outline: Outline;
  position: number;
};

export type ConflictRecord = {
  field: ConflictField;
  serverValue: unknown;
  serverBy: string;
  phoneValue: unknown;
  phoneBy: string;
};

export type PhotoRecord = {
  id: string;
  jobId: string;
  itemId: string;
  kind: 'defect' | 'completion';
  contentType: string;
  bytes: number;
  objectKey: string;
  uploadedBy: { name: string; role: JobRole };
  createdAt: Date;
};

export type NoteRecord = {
  id: string;
  itemId: string;
  parentId: string | null;
  audience: 'crew' | 'everyone';
  authorId: string;
  author: { name: string; role: JobRole };
  doc: NoteDoc;
  rev: number;
  body: string;
  createdAt: Date;
};

export type ItemRecord = {
  id: string;
  jobId: string;
  number: number;
  title: string;
  roomId: string;
  trade: Trade | null;
  status: ItemStatus;
  pin: UPoint | null;
  pinStatus: PinStatus;
  costNote: string | null;
  quantity: bigint | null;
  unitCost: bigint | null;
  sentBackReason: string | null;
  lastBy: string | null;
  createdById: string;
  createdBy: { name: string; role: JobRole };
  createdAt: Date;
  updatedAt: Date;
  blockedByIds: string[];
  blockedBy: number[];
  conflicts: ConflictRecord[];
  photos: PhotoRecord[];
  notes: NoteRecord[];
};

export type Viewer = {
  personId: string;
  role: JobRole;
  trade: Trade | null;
  memberId: string | null;
  name: string;
};

export function canSeeItem(viewer: Viewer, item: ItemRecord): boolean {
  if (viewer.role === 'trade') return item.trade !== null && item.trade === viewer.trade;
  return true;
}

export function canSeeNote(viewer: Viewer, note: NoteRecord): boolean {
  return note.audience === 'everyone' || viewer.role !== 'homeowner';
}

/* ------------------------------------------------------------------ loading */

function personRole(
  personId: string,
  roles: Map<string, JobRole>,
  owners: Set<string>,
): JobRole {
  if (owners.has(personId)) return 'owner';
  return roles.get(personId) ?? 'homeowner';
}

export async function loadJob(tx: Queryable, jobId: string): Promise<JobRecord | null> {
  const { rows } = await tx.query(
    `select id, firm_id, name, address, time_zone, status, created_at from jobs where id = $1`,
    [jobId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id as string,
    firmId: row.firm_id as string,
    name: row.name as string,
    address: row.address as string,
    timeZone: row.time_zone as string,
    status: row.status as JobStatus,
    createdAt: row.created_at as Date,
  };
}

export async function loadMembers(
  tx: Queryable,
  jobId: string,
  includeEnded = false,
): Promise<MemberRecord[]> {
  const { rows } = await tx.query(
    `select m.id, m.job_id, m.person_id, m.role, m.trade, m.active,
            p.name, p.email, p.phone
       from job_members m join people p on p.id = m.person_id
      where m.job_id = $1 ${includeEnded ? '' : 'and m.active'}
      order by m.created_at, m.id`,
    [jobId],
  );
  return rows.map((row) => ({
    id: row.id as string,
    jobId: row.job_id as string,
    personId: row.person_id as string,
    role: row.role as JobRole,
    trade: (row.trade as Trade | null) ?? null,
    active: row.active as boolean,
    name: row.name as string,
    email: row.email as string,
    phone: (row.phone as string | null) ?? null,
  }));
}

export async function loadRooms(tx: Queryable, jobId: string): Promise<RoomRecord[]> {
  const { rows } = await tx.query(
    `select id, job_id, name, outline, position from rooms where job_id = $1 order by position, created_at`,
    [jobId],
  );
  return rows.map((row) => ({
    id: row.id as string,
    jobId: row.job_id as string,
    name: row.name as string,
    outline: row.outline as Outline,
    position: row.position as number,
  }));
}

type RoleMaps = { roles: Map<string, JobRole>; owners: Set<string> };

async function roleMaps(tx: Queryable, jobId: string): Promise<RoleMaps> {
  const members = await loadMembers(tx, jobId, true);
  const roles = new Map<string, JobRole>();
  for (const member of members) roles.set(member.personId, member.role);
  const { rows } = await tx.query(
    `select p.id from people p join jobs j on j.firm_id = p.firm_id
      where j.id = $1 and p.is_owner`,
    [jobId],
  );
  return { roles, owners: new Set(rows.map((r) => r.id as string)) };
}

function readItemRow(row: Row, maps: RoleMaps): ItemRecord {
  const createdById = row.created_by as string;
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    number: row.number as number,
    title: row.title as string,
    roomId: row.room_id as string,
    trade: (row.trade as Trade | null) ?? null,
    status: row.status as ItemStatus,
    pin:
      row.pin_x === null || row.pin_x === undefined
        ? null
        : { x: row.pin_x as number, y: row.pin_y as number },
    pinStatus: row.pin_status as PinStatus,
    costNote: (row.cost_note as string | null) ?? null,
    quantity: row.quantity === null ? null : BigInt(row.quantity as string),
    unitCost: row.unit_cost === null ? null : BigInt(row.unit_cost as string),
    sentBackReason: (row.sent_back_reason as string | null) ?? null,
    lastBy: (row.last_by as string | null) ?? null,
    createdById,
    createdBy: {
      name: (row.created_by_name as string) ?? '',
      role: personRole(createdById, maps.roles, maps.owners),
    },
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    blockedByIds: [],
    blockedBy: [],
    conflicts: [],
    photos: [],
    notes: [],
  };
}

export async function loadItems(
  tx: Queryable,
  jobId: string,
  only?: string[],
): Promise<ItemRecord[]> {
  const maps = await roleMaps(tx, jobId);
  const filter = only === undefined ? '' : 'and i.id = any($2::uuid[])';
  const values: unknown[] = only === undefined ? [jobId] : [jobId, only];
  const { rows } = await tx.query(
    `select i.*, p.name as created_by_name
       from items i join people p on p.id = i.created_by
      where i.job_id = $1 ${filter}
      order by i.number`,
    values,
  );
  const items = rows.map((row) => readItemRow(row, maps));
  if (items.length === 0) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const ids = items.map((item) => item.id);

  const numbersByJob = new Map<string, number>();
  {
    const all = await tx.query(`select id, number from items where job_id = $1`, [jobId]);
    for (const row of all.rows) numbersByJob.set(row.id as string, row.number as number);
  }

  const blockers = await tx.query(
    `select item_id, blocker_id from item_blockers where item_id = any($1::uuid[])`,
    [ids],
  );
  for (const row of blockers.rows) {
    const item = byId.get(row.item_id as string);
    if (!item) continue;
    item.blockedByIds.push(row.blocker_id as string);
    const number = numbersByJob.get(row.blocker_id as string);
    if (number !== undefined) item.blockedBy.push(number);
  }
  for (const item of items) item.blockedBy.sort((a, b) => a - b);

  const conflicts = await tx.query(
    `select item_id, field, server_value, server_by, phone_value, phone_by
       from item_conflicts where item_id = any($1::uuid[])`,
    [ids],
  );
  for (const row of conflicts.rows) {
    byId.get(row.item_id as string)?.conflicts.push({
      field: row.field as ConflictField,
      serverValue: row.server_value,
      serverBy: row.server_by as string,
      phoneValue: row.phone_value,
      phoneBy: row.phone_by as string,
    });
  }

  const photos = await tx.query(
    `select h.*, p.name as uploader_name
       from photos h join people p on p.id = h.uploaded_by
      where h.item_id = any($1::uuid[])
      order by h.created_at, h.id`,
    [ids],
  );
  for (const row of photos.rows) {
    byId.get(row.item_id as string)?.photos.push({
      id: row.id as string,
      jobId: row.job_id as string,
      itemId: row.item_id as string,
      kind: row.kind as 'defect' | 'completion',
      contentType: row.content_type as string,
      bytes: row.bytes as number,
      objectKey: row.object_key as string,
      uploadedBy: {
        name: row.uploader_name as string,
        role: personRole(row.uploaded_by as string, maps.roles, maps.owners),
      },
      createdAt: row.created_at as Date,
    });
  }

  const notes = await tx.query(
    `select n.*, p.name as author_name
       from notes n join people p on p.id = n.author_id
      where n.item_id = any($1::uuid[])
      order by n.created_at, n.id`,
    [ids],
  );
  for (const row of notes.rows) {
    byId.get(row.item_id as string)?.notes.push(readNoteRow(row, maps));
  }
  return items;
}

function readNoteRow(row: Row, maps: RoleMaps): NoteRecord {
  const authorId = row.author_id as string;
  return {
    id: row.id as string,
    itemId: row.item_id as string,
    parentId: (row.parent_id as string | null) ?? null,
    audience: row.audience as 'crew' | 'everyone',
    authorId,
    author: {
      name: row.author_name as string,
      role: personRole(authorId, maps.roles, maps.owners),
    },
    doc: row.doc as NoteDoc,
    rev: row.rev as number,
    body: row.body as string,
    createdAt: row.created_at as Date,
  };
}

export async function loadNote(
  tx: Queryable,
  jobId: string,
  noteId: string,
): Promise<NoteRecord | null> {
  const maps = await roleMaps(tx, jobId);
  const { rows } = await tx.query(
    `select n.*, p.name as author_name
       from notes n join people p on p.id = n.author_id
      where n.job_id = $1 and n.id = $2`,
    [jobId, noteId],
  );
  return rows.length === 0 ? null : readNoteRow(rows[0], maps);
}

/* ------------------------------------------------------------- projections */

export type Counts = { verified: number; total: number };
export type Progress = { verified: number; total: number; percent: number };

/** The single derived-count calculation shared by the list, the plan, the API, events and email. */
export function roomCounts(items: ItemRecord[], viewer: Viewer, roomId: string): Counts {
  let verified = 0;
  let total = 0;
  for (const item of items) {
    if (item.roomId !== roomId || !canSeeItem(viewer, item)) continue;
    total++;
    if (item.status === 'verified') verified++;
  }
  return { verified, total };
}

export function jobProgress(items: ItemRecord[], viewer: Viewer): Progress {
  let verified = 0;
  let total = 0;
  for (const item of items) {
    if (!canSeeItem(viewer, item)) continue;
    total++;
    if (item.status === 'verified') verified++;
  }
  return {
    verified,
    total,
    percent: total === 0 ? 0 : Math.floor((verified * 100) / total),
  };
}

function boundsJson(bounds: Bounds): Record<string, number> {
  return {
    x: unitsToFraction(bounds.x),
    y: unitsToFraction(bounds.y),
    w: unitsToFraction(bounds.w),
    h: unitsToFraction(bounds.h),
  };
}

export function projectRoom(room: RoomRecord, counts: Counts): Record<string, unknown> {
  const anchor = anchorOf(room.outline);
  return {
    id: room.id,
    name: room.name,
    outline: room.outline.map((p) => ({ x: unitsToFraction(p.x), y: unitsToFraction(p.y) })),
    bounds: boundsJson(boundsOf(room.outline)),
    anchor: { x: anchorToFraction(anchor.x), y: anchorToFraction(anchor.y) },
    counts,
  };
}

export function projectPhoto(photo: PhotoRecord): Record<string, unknown> {
  return {
    id: photo.id,
    kind: photo.kind,
    content_type: photo.contentType,
    bytes: photo.bytes,
    url: `/api/jobs/${photo.jobId}/photos/${photo.id}`,
    uploaded_by: photo.uploadedBy,
    created_at: photo.createdAt.toISOString(),
  };
}

export function projectNote(
  note: NoteRecord,
  replies: NoteRecord[] | null,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: note.id,
    body: note.body,
    audience: note.audience,
    author: note.author,
    rev: note.rev,
    created_at: note.createdAt.toISOString(),
  };
  if (replies !== null) base.replies = replies.map((reply) => projectNote(reply, null));
  return base;
}

export function projectNoteThread(item: ItemRecord, viewer: Viewer): Record<string, unknown>[] {
  const visible = item.notes.filter((note) => canSeeNote(viewer, note));
  const tops = visible.filter((note) => note.parentId === null);
  return tops.map((note) =>
    projectNote(
      note,
      visible.filter((reply) => reply.parentId === note.id),
    ),
  );
}

export function projectItem(item: ItemRecord, viewer: Viewer): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: item.id,
    number: item.number,
    title: item.title,
    room_id: item.roomId,
    trade: item.trade,
    status: item.status,
    pin:
      item.pin === null
        ? null
        : { x: unitsToFraction(item.pin.x), y: unitsToFraction(item.pin.y) },
    pin_status: item.pinStatus,
    blocked_by: item.blockedBy,
    created_by: item.createdBy,
    photos: item.photos.map(projectPhoto),
    notes: projectNoteThread(item, viewer),
    updated_at: item.updatedAt.toISOString(),
  };
  if (viewer.role === 'owner' || viewer.role === 'lead') {
    base.cost_note = item.costNote;
    base.quantity = formatQuantity(item.quantity);
    base.unit_cost = formatMoney(item.unitCost);
    base.line_total = formatMoney(lineTotal(item.quantity, item.unitCost));
    base.sent_back_reason = item.sentBackReason;
    base.conflicts = item.conflicts.map((conflict) => ({
      field: conflict.field,
      server_value: conflict.serverValue,
      server_by: conflict.serverBy,
      phone_value: conflict.phoneValue,
      phone_by: conflict.phoneBy,
    }));
  } else if (viewer.role === 'trade') {
    base.sent_back_reason = item.sentBackReason;
  }
  return base;
}

export function projectMember(member: MemberRecord, viewer: Viewer): Record<string, unknown> {
  const full =
    viewer.role === 'owner' ||
    viewer.role === 'lead' ||
    member.role === 'owner' ||
    member.role === 'lead' ||
    member.personId === viewer.personId;
  const base: Record<string, unknown> = {
    id: member.id,
    name: member.name,
    role: member.role,
    trade: member.trade,
  };
  if (full) {
    base.email = member.email;
    base.phone = member.phone;
  }
  return base;
}

/* ------------------------------------------------------------------- pins */

/** The published shared-edge order: the request's room, then the item's room, then the earliest. */
export function roomForPin(
  rooms: RoomRecord[],
  pin: UPoint,
  preferredRoomId: string | null,
  currentRoomId: string | null,
): RoomRecord | null {
  const containing = rooms.filter((room) => insideOutline(pin, room.outline));
  if (containing.length === 0) return null;
  if (preferredRoomId !== null) {
    const preferred = containing.find((room) => room.id === preferredRoomId);
    if (preferred) return preferred;
  }
  if (currentRoomId !== null) {
    const current = containing.find((room) => room.id === currentRoomId);
    if (current) return current;
  }
  return containing[0];
}

export function pinFraction(pin: UPoint): { x: number; y: number } {
  return { x: unitsToFraction(pin.x), y: unitsToFraction(pin.y) };
}

export function wholePercent(units: number): number {
  return Math.floor((units * 100) / PLAN_UNITS + 0.5);
}

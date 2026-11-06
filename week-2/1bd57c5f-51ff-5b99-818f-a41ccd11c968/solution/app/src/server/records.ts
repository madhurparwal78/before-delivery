import type { EditableField, FieldValue, ItemFields, ItemStatus, NoteAudience, PhotoKind, PinStatus, Role, Trade } from "../shared/domain";
import type { Outline } from "../shared/geometry";
import type { PatchedItem } from "../shared/fields";
import { canSeeNote, scopeTrade, type JobAccess } from "./access";
import { rows, sequence, type Db } from "./db";

// Reading punch items with their photos, notes, conflicts and blockers. Records keep every
// note and every value whatever the reader's role; projection.ts cuts them down per role,
// so the event log can store a record once and project it for each receiver.

export interface PhotoRecord {
  id: string;
  job_id: string;
  item_id: string;
  kind: PhotoKind;
  object_key: string;
  content_type: string;
  bytes: number;
  uploaded_by: string;
  uploader_name: string;
  uploaded_by_role: Role;
  created_at: string;
}

export interface NoteRecord {
  id: string;
  item_id: string;
  parent_id: string | null;
  body: string;
  audience: NoteAudience;
  author_id: string;
  author_name: string;
  author_role: Role;
  rev: number;
  created_at: string;
}

interface ConflictRecord {
  item_id: string;
  field: EditableField;
  server_value: FieldValue;
  server_by_name: string;
  phone_value: FieldValue;
  phone_by_name: string;
}

export interface ItemRow {
  id: string;
  job_id: string;
  number: number;
  title: string;
  room_id: string;
  trade: Trade | null;
  status: ItemStatus;
  pin_x: number | null;
  pin_y: number | null;
  pin_status: PinStatus;
  cost_note: string | null;
  quantity: string | null;
  unit_cost: string | null;
  sent_back_reason: string | null;
  created_by: string;
  creator_name: string;
  created_by_role: Role;
  set_by: Partial<Record<EditableField, string>>;
  updated_at: string;
}

export interface ItemRecord extends ItemRow {
  blocked_by: number[];
  photos: PhotoRecord[];
  notes: NoteRecord[];
  conflicts: ConflictRecord[];
}

export function fieldsOf(row: ItemRow): ItemFields {
  return {
    title: row.title,
    room_id: row.room_id,
    trade: row.trade,
    cost_note: row.cost_note,
    quantity: row.quantity,
    unit_cost: row.unit_cost,
    pin: row.pin_x === null || row.pin_y === null ? null : { x: row.pin_x, y: row.pin_y },
  };
}

export function patchedOf(row: ItemRow): PatchedItem {
  return { fields: fieldsOf(row), pinStatus: row.pin_status };
}

const ITEM_COLUMNS = `i.id, i.job_id, i.number, i.title, i.room_id, i.trade, i.status, i.pin_x, i.pin_y, i.pin_status,
  i.cost_note, i.quantity, i.unit_cost, i.sent_back_reason, i.created_by, p.name AS creator_name, i.created_by_role,
  i.set_by, i.updated_at`;

/** Item rows on a job, in room creation order then by number; `trade` limits them to one trade's scope. */
function loadItemRows(db: Db, jobId: string, trade: Trade | null, itemIds: string[] | null = null): Promise<ItemRow[]> {
  return rows<ItemRow>(
    db,
    `SELECT ${ITEM_COLUMNS}
     FROM items i JOIN people p ON p.id = i.created_by JOIN rooms r ON r.id = i.room_id
     WHERE i.job_id = $1 AND ($2::text IS NULL OR i.trade = $2) AND ($3::uuid[] IS NULL OR i.id = ANY($3))
     ORDER BY r.position, i.number`,
    [jobId, trade, itemIds],
  );
}

/** Item rows in the caller's scope. */
export function scopedItemRows(db: Db, access: JobAccess, itemIds: string[] | null = null): Promise<ItemRow[]> {
  return loadItemRows(db, access.job.id, scopeTrade(access), itemIds);
}

/** One item row locked for an update, ignoring scope (callers check visibility). */
export async function lockItemRow(db: Db, jobId: string, itemId: string): Promise<ItemRow | null> {
  const found = await rows<ItemRow>(
    db,
    `SELECT ${ITEM_COLUMNS} FROM items i JOIN people p ON p.id = i.created_by
     WHERE i.job_id = $1 AND i.id = $2 FOR UPDATE OF i`,
    [jobId, itemId],
  );
  return found[0] ?? null;
}

async function withDetails(db: Db, items: ItemRow[]): Promise<ItemRecord[]> {
  const ids = items.map((item) => item.id);
  const [photos, notes, conflicts, blockers] = await sequence(
    () =>
      rows<PhotoRecord>(
        db,
        `SELECT ph.id, ph.job_id, ph.item_id, ph.kind, ph.object_key, ph.content_type, ph.bytes, ph.uploaded_by,
              p.name AS uploader_name, ph.uploaded_by_role, ph.created_at
       FROM photos ph JOIN people p ON p.id = ph.uploaded_by WHERE ph.item_id = ANY($1) ORDER BY ph.position`,
        [ids],
      ),
    () =>
      rows<NoteRecord>(
        db,
        `SELECT n.id, n.item_id, n.parent_id, n.body, n.audience, n.author_id, p.name AS author_name, n.author_role, n.rev, n.created_at
       FROM notes n JOIN people p ON p.id = n.author_id WHERE n.item_id = ANY($1) ORDER BY n.position`,
        [ids],
      ),
    () =>
      rows<ConflictRecord>(
        db,
        `SELECT c.item_id, c.field, c.server_value, s.name AS server_by_name, c.phone_value, ph.name AS phone_by_name
       FROM item_conflicts c JOIN people s ON s.id = c.server_by JOIN people ph ON ph.id = c.phone_by
       WHERE c.item_id = ANY($1) ORDER BY c.field`,
        [ids],
      ),
    () =>
      rows<{ item_id: string; number: number }>(
        db,
        `SELECT b.item_id, i.number FROM item_blockers b JOIN items i ON i.id = b.blocker_id
       WHERE b.item_id = ANY($1) ORDER BY i.number`,
        [ids],
      ),
  );
  return items.map((item) => ({
    ...item,
    blocked_by: blockers.filter((blocker) => blocker.item_id === item.id).map((blocker) => blocker.number),
    photos: photos.filter((photo) => photo.item_id === item.id),
    notes: notes.filter((note) => note.item_id === item.id),
    conflicts: conflicts.filter((conflict) => conflict.item_id === item.id),
  }));
}

/** Full item records in the caller's scope (projection then drops what the role may not see). */
export async function loadItems(db: Db, access: JobAccess, itemIds: string[] | null = null): Promise<ItemRecord[]> {
  return withDetails(db, await scopedItemRows(db, access, itemIds));
}

/** Full item records whatever the scope, for the event log. */
export async function loadItemRecords(db: Db, jobId: string, itemIds: string[]): Promise<ItemRecord[]> {
  return withDetails(db, await loadItemRows(db, jobId, null, itemIds));
}

/** Notes a caller may see on an item record. */
export function visibleNotes(access: Pick<JobAccess, "role">, notes: readonly NoteRecord[]): NoteRecord[] {
  return notes.filter((note) => canSeeNote(access, note.audience));
}

/** Rooms in creation order, the order lists, rollups and the summary follow. */
export interface RoomRow {
  id: string;
  name: string;
  outline: Outline;
}

export function loadRooms(db: Db, jobId: string): Promise<RoomRow[]> {
  return rows<RoomRow>(db, "SELECT id, name, outline FROM rooms WHERE job_id = $1 ORDER BY position", [jobId]);
}

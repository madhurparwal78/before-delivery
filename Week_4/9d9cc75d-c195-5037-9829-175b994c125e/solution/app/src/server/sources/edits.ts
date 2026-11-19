// Field, relation, hierarchy and security edits. Routes and the grading seed both write through these.
import type { Cell, Entitlements, FieldKind, Relation, SourceField } from '../../shared/model.ts';
import { newId } from '../db/ids.ts';
import { snapshotTables } from '../extracts/snapshot.ts';
import type { App } from '../http/app.ts';
import { invalid, notFound } from '../http/errors.ts';
import { isObject, isString, nonBlank } from '../http/validate.ts';
import type { FieldRecord } from './fields.ts';
import { binFieldName, defaultContinuous, groupFieldName, nameClash } from './fields.ts';
import { syncFields } from './ingest.ts';
import { NAME_REQUIRED } from '../projects/routes.ts';
import { getFields, getSource, lockSource, saveFields, touch } from './repo.ts';

const KEY_TYPES_MESSAGE = 'Keys must have the same type.';
const BIN_SIZE_MESSAGE = 'Bin size must be a whole number of at least 1.';

export function fieldView(f: FieldRecord): SourceField {
  return { id: f.id, name: f.name, table: f.table, type: f.type, kind: f.kind, continuous: f.continuous, hidden: f.hidden };
}

/** The fields a person works with: every stored field except the right-table join key. */
export function listedFields(fields: readonly FieldRecord[]): FieldRecord[] {
  return fields.filter((f) => !f.dropped);
}

/** A listed field by id, or else by its current name; 404 when neither matches. */
export function findField(fields: readonly FieldRecord[], ref: unknown): FieldRecord {
  const listed = listedFields(fields);
  const found = listed.find((f) => f.id === ref) ?? listed.find((f) => f.name === ref);
  if (!found) throw notFound();
  return found;
}

function assertFreeName(fields: readonly FieldRecord[], name: string, except: string | null, key: string): void {
  if (listedFields(fields).some((f) => f.name === name && f.id !== except)) throw invalid({ [key]: nameClash(name) });
}

/** Relates the source's two tables on one key column from each (column names as uploaded). */
export async function setRelation(app: App, sourceId: string, body: Record<string, unknown>): Promise<Relation> {
  const tables = await snapshotTables(app.db, sourceId);
  const column = (tableKey: string, columnKey: string) => {
    const table = tables.find((t) => t.table_name === body[tableKey]);
    const found = table?.columns.find((c) => c.name === body[columnKey]);
    if (!table || !found) throw notFound();
    return { table: table.table_name, column: found };
  };
  const left = column('left_table', 'left_key');
  const right = column('right_table', 'right_key');
  if (left.table === right.table) throw notFound();
  if (left.column.type !== right.column.type) throw invalid({ right_key: KEY_TYPES_MESSAGE });
  const relation: Relation = {
    left_table: left.table,
    left_key: left.column.name,
    right_table: right.table,
    right_key: right.column.name,
  };
  await app.db.transaction(async (tx) => {
    await tx.exec(`UPDATE sources SET relation = $2 WHERE id = $1`, [sourceId, JSON.stringify(relation)]);
    await syncFields(tx, sourceId);
  });
  return relation;
}

const KINDS: readonly FieldKind[] = ['dimension', 'measure'];

/** Rename, hide or show, or change the kind of one field. A rename carries everywhere because formulas use ids. */
export async function patchField(app: App, sourceId: string, fieldId: string, body: Record<string, unknown>) {
  return app.db.transaction(async (tx) => {
    await lockSource(tx, sourceId);
    const fields = await getFields(tx, sourceId);
    const field = listedFields(fields).find((f) => f.id === fieldId);
    if (!field) throw notFound();
    const next: FieldRecord = { ...field };
    if (body.name !== undefined) {
      const name = nonBlank(body.name);
      if (name === null) throw invalid({ name: NAME_REQUIRED });
      assertFreeName(fields, name.trim(), field.id, 'name');
      next.name = name.trim();
    }
    if (body.hidden !== undefined) {
      if (typeof body.hidden !== 'boolean') throw invalid({});
      next.hidden = body.hidden;
    }
    if (body.kind !== undefined) {
      const kind = KINDS.find((k) => k === body.kind);
      if (!kind) throw invalid({});
      next.kind = kind;
      next.continuous = defaultContinuous(field.type, kind);
    }
    await saveFields(
      tx,
      sourceId,
      fields.map((f) => (f.id === field.id ? next : f)),
    );
    return fieldView(next);
  });
}

async function addDerived(app: App, sourceId: string, record: FieldRecord): Promise<SourceField> {
  return app.db.transaction(async (tx) => {
    await lockSource(tx, sourceId);
    const fields = await getFields(tx, sourceId);
    assertFreeName(fields, record.name, null, 'field');
    await saveFields(tx, sourceId, [...fields, record]);
    return fieldView(record);
  });
}

/** `{field} (bin)`: a discrete dimension of `floor(x / size) * size` starts. */
export async function addBins(app: App, sourceId: string, body: Record<string, unknown>): Promise<SourceField> {
  const field = findField(await getFields(app.db, sourceId), body.field);
  const size = body.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) throw invalid({ size: BIN_SIZE_MESSAGE });
  if (field.type !== 'number') throw invalid({});
  return addDerived(app, sourceId, {
    id: newId(),
    name: binFieldName(field.name),
    table: null,
    type: 'text',
    kind: 'dimension',
    continuous: false,
    hidden: false,
    column: null,
    dropped: false,
    derived: { kind: 'bin', field: field.id, size },
  });
}

function isCell(value: unknown): value is Cell {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/** `{field} (group)`: grouped members show as their group's name, the others stay as they are. */
export async function addGroups(app: App, sourceId: string, body: Record<string, unknown>): Promise<SourceField> {
  const field = findField(await getFields(app.db, sourceId), body.field);
  const raw = body.groups;
  if (!Array.isArray(raw) || raw.length === 0) throw invalid({ groups: NAME_REQUIRED });
  const groups = raw.map((g: unknown) => {
    const name = isObject(g) ? nonBlank(g.name) : null;
    const members = isObject(g) ? g.members : null;
    if (name === null || !Array.isArray(members) || !members.every(isCell)) throw invalid({ groups: NAME_REQUIRED });
    return { name: name.trim(), members };
  });
  return addDerived(app, sourceId, {
    id: newId(),
    name: groupFieldName(field.name),
    table: null,
    type: 'text',
    kind: 'dimension',
    continuous: false,
    hidden: false,
    column: null,
    dropped: false,
    derived: { kind: 'group', field: field.id, groups },
  });
}

/** The source's one drill hierarchy, top level first. Stored by field id so renames carry. */
export async function setHierarchy(app: App, sourceId: string, body: Record<string, unknown>) {
  const fields = await getFields(app.db, sourceId);
  const levels = Array.isArray(body.fields) ? body.fields.map((ref: unknown) => findField(fields, ref)) : null;
  const name = nonBlank(body.name);
  if (name === null) throw invalid({ name: NAME_REQUIRED });
  if (levels === null || levels.length === 0) throw invalid({ fields: NAME_REQUIRED });
  await app.db.exec(`UPDATE sources SET hierarchy = $2 WHERE id = $1`, [
    sourceId,
    JSON.stringify({ name: name.trim(), fields: levels.map((f) => f.id) }),
  ]);
  await touch(app.db, sourceId);
  return { name: name.trim(), fields: levels.map((f) => f.name) };
}

/** Row-level security: one field and, per lower-case username, the values that user may see. */
export async function setEntitlements(app: App, sourceId: string, body: Record<string, unknown>): Promise<Entitlements> {
  const fields = await getFields(app.db, sourceId);
  const field = body.field === null ? null : findField(fields, body.field);
  if (!isObject(body.users)) throw invalid({ users: NAME_REQUIRED });
  const users: Record<string, string[]> = {};
  for (const [username, values] of Object.entries(body.users)) {
    if (!Array.isArray(values) || !values.every((v) => isString(v) || typeof v === 'number')) throw invalid({});
    users[username.toLowerCase()] = values.map(String);
  }
  await app.db.exec(`UPDATE sources SET security_field = $2, entitlements = $3 WHERE id = $1`, [
    sourceId,
    field?.id ?? null,
    JSON.stringify(users),
  ]);
  await touch(app.db, sourceId);
  return { field: field?.name ?? null, users };
}

/** The entitlements as the API shows them: the security field by its current name. */
export async function entitlementsOf(app: App, sourceId: string): Promise<Entitlements> {
  const source = await getSource(app.db, sourceId);
  if (!source) throw notFound();
  const fields = await getFields(app.db, sourceId);
  const field = fields.find((f) => f.id === source.security_field);
  return { field: field?.name ?? null, users: source.entitlements };
}

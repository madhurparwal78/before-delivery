import { PLACEHOLDER_TEXT } from "../shared/copy.js";
import { depthOf, type PlacementRef, type PlacementTree } from "../shared/moves.js";
import { mentionsOf, recognizeDate, tagsOf } from "../shared/text.js";
import type { Bullet } from "../shared/types.js";
import type { Db } from "./db.js";
import { pool } from "./db.js";

export interface Row extends PlacementRef {
  ownerId: string;
  position: number;
  text: string;
  completed: boolean;
  collapsed: boolean;
  revision: number;
  trashedAt: Date | null;
  purgeAt: Date | null;
}

interface RowRecord {
  id: string;
  owner_id: string;
  parent_id: string | null;
  position: number;
  text: string;
  completed: boolean;
  collapsed: boolean;
  mirror_of: string | null;
  revision: number;
  trashed_at: Date | null;
  purge_at: Date | null;
}

const COLUMNS = "id, owner_id, parent_id, position, text, completed, collapsed, mirror_of, revision, trashed_at, purge_at";

const toRow = (record: RowRecord): Row => ({
  id: record.id,
  ownerId: record.owner_id,
  parentId: record.parent_id,
  position: record.position,
  text: record.text,
  completed: record.completed,
  collapsed: record.collapsed,
  mirrorOf: record.mirror_of,
  revision: record.revision,
  trashedAt: record.trashed_at,
  purgeAt: record.purge_at,
});

interface RevisionEntry {
  bulletId: string;
  revision: number;
  accountId: string;
}

/** Every bullet of one owner's outline, in memory, with the rules that keep its sibling order whole. */
export class OutlineState implements PlacementTree {
  readonly rows = new Map<string, Row>();
  readonly touched = new Set<string>();
  readonly inserted = new Set<string>();
  readonly reshaped = new Set<string | null>();
  readonly revisions: RevisionEntry[] = [];
  private readonly kids = new Map<string | null, string[]>();

  constructor(readonly ownerId: string, rows: Row[], readonly today: string) {
    for (const row of rows) this.rows.set(row.id, row);
    for (const row of [...rows].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
      if (row.trashedAt === null) this.listOf(row.parentId).push(row.id);
    }
  }

  private listOf(parentId: string | null): string[] {
    let list = this.kids.get(parentId);
    if (list === undefined) {
      list = [];
      this.kids.set(parentId, list);
    }
    return list;
  }

  placement(id: string): Row | undefined {
    const row = this.rows.get(id);
    return row !== undefined && row.trashedAt === null ? row : undefined;
  }

  childrenOf(containerId: string | null): readonly string[] {
    return this.kids.get(containerId) ?? [];
  }

  originalOf(row: Row): Row | undefined {
    return row.mirrorOf === null ? row : this.placement(row.mirrorOf);
  }

  copiesOf(originalId: string): Row[] {
    return [...this.rows.values()].filter((row) => row.mirrorOf === originalId && row.trashedAt === null);
  }

  activeIds(): string[] {
    return [...this.rows.values()].filter((row) => row.trashedAt === null).map((row) => row.id);
  }

  private renumber(parentId: string | null): void {
    this.reshaped.add(parentId);
    this.listOf(parentId).forEach((id, index) => {
      const row = this.rows.get(id);
      if (row !== undefined && row.position !== index) {
        row.position = index;
        this.touched.add(id);
      }
    });
  }

  private detach(row: Row): void {
    const list = this.listOf(row.parentId);
    const at = list.indexOf(row.id);
    if (at >= 0) list.splice(at, 1);
    this.renumber(row.parentId);
  }

  private attach(row: Row, parentId: string | null, index: number): void {
    row.parentId = parentId;
    this.listOf(parentId).splice(index, 0, row.id);
    this.renumber(parentId);
    this.touched.add(row.id);
  }

  insert(row: Row, index: number): void {
    this.rows.set(row.id, row);
    this.inserted.add(row.id);
    this.attach(row, row.parentId, index);
  }

  place(id: string, parentId: string | null, index: number): void {
    const row = this.rows.get(id);
    if (row === undefined) return;
    this.detach(row);
    this.attach(row, parentId, index);
  }

  expand(id: string): void {
    this.setCollapsed(id, false);
  }

  /** Moves a bullet and everything inside it to the trash; returns the ids moved. */
  trash(id: string, at: Date, purgeAt: Date): string[] {
    const root = this.placement(id);
    if (root === undefined) return [];
    const moved: string[] = [];
    const collect = (rowId: string): void => {
      moved.push(rowId);
      for (const child of this.childrenOf(rowId)) collect(child);
    };
    collect(id);
    this.detach(root);
    for (const movedId of moved) {
      const row = this.rows.get(movedId);
      if (row !== undefined) {
        row.trashedAt = at;
        row.purgeAt = purgeAt;
        this.touched.add(movedId);
      }
    }
    for (const movedId of moved) this.kids.delete(movedId);
    return moved;
  }

  /** Brings back trashed bullets: the branch's top goes to `index` under `parentId`, the rest keep their order. */
  restore(ids: readonly string[], parentId: string | null, index: number): void {
    const [top, ...rest] = ids;
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row !== undefined) {
        row.trashedAt = null;
        row.purgeAt = null;
        this.touched.add(id);
      }
    }
    const lists = new Set<string | null>();
    for (const id of rest) {
      const row = this.rows.get(id);
      if (row !== undefined) {
        this.listOf(row.parentId).push(id);
        lists.add(row.parentId);
      }
    }
    for (const listParent of lists) {
      this.listOf(listParent).sort((a, b) => (this.rows.get(a)?.position ?? 0) - (this.rows.get(b)?.position ?? 0));
    }
    const topRow = top === undefined ? undefined : this.rows.get(top);
    if (topRow !== undefined) this.attach(topRow, parentId, Math.min(index, this.childrenOf(parentId).length));
  }

  edit(id: string, accountId: string, change: { text?: string; completed?: boolean }): void {
    const row = this.rows.get(id);
    if (row === undefined) return;
    if (change.text !== undefined) row.text = change.text;
    if (change.completed !== undefined) row.completed = change.completed;
    row.revision += 1;
    this.touched.add(id);
    this.revisions.push({ bulletId: id, revision: row.revision, accountId });
  }

  setCollapsed(id: string, collapsed: boolean): void {
    const row = this.rows.get(id);
    if (row !== undefined && row.collapsed !== collapsed) {
      row.collapsed = collapsed;
      this.touched.add(id);
    }
  }

  bullet(row: Row, depth: number): Bullet {
    const original = this.originalOf(row);
    if (original === undefined) {
      return {
        id: row.id, parentId: row.parentId, position: row.position, depth, text: "", completed: false,
        collapsed: row.collapsed, date: null, tags: [], mentions: [], mirrorOf: row.mirrorOf,
        placeholder: true, revision: 0, childCount: 0,
      };
    }
    return {
      id: row.id,
      parentId: row.parentId,
      position: row.position,
      depth,
      text: original.text,
      completed: original.completed,
      collapsed: row.collapsed,
      date: recognizeDate(original.text, this.today).date,
      tags: tagsOf(original.text),
      mentions: mentionsOf(original.text),
      mirrorOf: row.mirrorOf,
      placeholder: false,
      revision: original.revision,
      childCount: this.childrenOf(original.id).length,
    };
  }

  canonicalBullet(row: Row): Bullet {
    return this.bullet(row, depthOf(this, row.id));
  }

  textOf(row: Row): string {
    return this.originalOf(row)?.text ?? PLACEHOLDER_TEXT;
  }
}

export async function loadState(client: Db | typeof pool, ownerId: string, today: string): Promise<OutlineState> {
  const found = await client.query<RowRecord>(
    `SELECT ${COLUMNS} FROM bullets WHERE owner_id = $1 AND (purge_at IS NULL OR purge_at > now())`,
    [ownerId],
  );
  return new OutlineState(ownerId, found.rows.map(toRow), today);
}

export async function flushState(client: Db, state: OutlineState): Promise<void> {
  for (const id of state.inserted) {
    const row = state.rows.get(id);
    if (row === undefined) continue;
    await client.query(
      `INSERT INTO bullets (id, owner_id, parent_id, position, text, completed, collapsed, mirror_of, revision, trashed_at, purge_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [row.id, row.ownerId, row.parentId, row.position, row.text, row.completed, row.collapsed, row.mirrorOf,
        row.revision, row.trashedAt, row.purgeAt],
    );
  }
  const changed = [...state.touched].filter((id) => !state.inserted.has(id)).flatMap((id) => {
    const row = state.rows.get(id);
    return row === undefined ? [] : [row];
  });
  if (changed.length > 0) {
    await client.query(
      `UPDATE bullets b SET parent_id = v.parent_id, position = v.position, text = v.text, completed = v.completed,
         collapsed = v.collapsed, revision = v.revision, trashed_at = v.trashed_at, purge_at = v.purge_at
       FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::bool[], $6::bool[], $7::int[], $8::timestamptz[], $9::timestamptz[])
         AS v(id, parent_id, position, text, completed, collapsed, revision, trashed_at, purge_at)
       WHERE b.id = v.id`,
      [
        changed.map((row) => row.id), changed.map((row) => row.parentId), changed.map((row) => row.position),
        changed.map((row) => row.text), changed.map((row) => row.completed), changed.map((row) => row.collapsed),
        changed.map((row) => row.revision), changed.map((row) => row.trashedAt), changed.map((row) => row.purgeAt),
      ],
    );
  }
  for (const entry of state.revisions) {
    await client.query(
      "INSERT INTO revisions (bullet_id, revision, account_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [entry.bulletId, entry.revision, entry.accountId],
    );
  }
}

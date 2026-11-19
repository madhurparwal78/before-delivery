import type { PoolClient } from 'pg';
import type { Bullet } from '../shared/types.js';
import { pool } from './db.js';

export interface BulletRow {
  id: string;
  ownerId: string;
  parentId: string | null;
  position: number;
  text: string;
  completed: boolean;
  collapsed: boolean;
  date: string | null;
  tags: string[];
  mentions: string[];
  mirrorOf: string | null;
  revision: number;
  revisionAuthor: string | null;
}

export interface RawRow {
  id: string;
  owner_id: string;
  parent_id: string | null;
  position: number;
  text: string;
  completed: boolean;
  collapsed: boolean;
  date: Date | string | null;
  tags: string[];
  mentions: string[];
  mirror_of: string | null;
  revision: number;
  revision_author: string | null;
}

export function toBulletRow(raw: RawRow): BulletRow {
  const date =
    raw.date === null
      ? null
      : raw.date instanceof Date
        ? `${raw.date.getUTCFullYear()}-${String(raw.date.getUTCMonth() + 1).padStart(2, '0')}-${String(raw.date.getUTCDate()).padStart(2, '0')}`
        : String(raw.date).slice(0, 10);
  return {
    id: raw.id,
    ownerId: raw.owner_id,
    parentId: raw.parent_id,
    position: raw.position,
    text: raw.text,
    completed: raw.completed,
    collapsed: raw.collapsed,
    date,
    tags: raw.tags,
    mentions: raw.mentions,
    mirrorOf: raw.mirror_of,
    revision: raw.revision,
    revisionAuthor: raw.revision_author
  };
}

export const ROW_COLUMNS =
  'id, owner_id, parent_id, position, text, completed, collapsed, date, tags, mentions, mirror_of, revision, revision_author';

/** A bullet placement in a view, with the depth and parent the view gives it. */
export interface DisplayNode {
  row: BulletRow;
  displayParentId: string | null;
  depth: number;
}

/** All the live placements of one outline, with the display tree that copies produce. */
export class Tree {
  private readonly rows = new Map<string, BulletRow>();
  private readonly childLists = new Map<string, BulletRow[]>();
  private readonly copyLists = new Map<string, BulletRow[]>();

  constructor(rows: readonly BulletRow[]) {
    for (const row of rows) this.rows.set(row.id, row);
    for (const row of rows) {
      const key = row.parentId ?? '';
      const list = this.childLists.get(key);
      if (list) list.push(row);
      else this.childLists.set(key, [row]);
      if (row.mirrorOf !== null) {
        const copies = this.copyLists.get(row.mirrorOf);
        if (copies) copies.push(row);
        else this.copyLists.set(row.mirrorOf, [row]);
      }
    }
    for (const list of this.childLists.values()) list.sort((a, b) => a.position - b.position);
  }

  row(id: string): BulletRow | undefined {
    return this.rows.get(id);
  }

  children(parentId: string | null): BulletRow[] {
    return this.childLists.get(parentId ?? '') ?? [];
  }

  copies(id: string): BulletRow[] {
    return this.copyLists.get(id) ?? [];
  }

  /** The row whose content a placement shows: the original for a copy, else itself. */
  original(row: BulletRow): BulletRow | undefined {
    return row.mirrorOf === null ? row : this.rows.get(row.mirrorOf);
  }

  isPlaceholder(row: BulletRow): boolean {
    return row.mirrorOf !== null && this.rows.get(row.mirrorOf) === undefined;
  }

  /** The children a placement shows: a copy shows the original's children. */
  displayChildren(row: BulletRow): BulletRow[] {
    const original = this.original(row);
    return original === undefined ? [] : this.children(original.id);
  }

  /** The real placement chain above a bullet, top-most first. */
  ancestors(id: string): BulletRow[] {
    const chain: BulletRow[] = [];
    let current = this.rows.get(id);
    while (current?.parentId != null) {
      const parent = this.rows.get(current.parentId);
      if (parent === undefined) break;
      chain.unshift(parent);
      current = parent;
    }
    return chain;
  }

  depthOf(id: string): number {
    return this.ancestors(id).length;
  }

  /** The placements a bullet can be reached through, upwards, counting copies on the way. */
  reach(id: string): Set<string> {
    const seen = new Set<string>([id]);
    for (const copy of this.copies(id)) seen.add(copy.id);
    const frontier = [...seen];
    while (frontier.length > 0) {
      const current = frontier.pop()!;
      const parentId = this.rows.get(current)?.parentId ?? null;
      if (parentId === null) continue;
      for (const candidate of [parentId, ...this.copies(parentId).map((copy) => copy.id)]) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          frontier.push(candidate);
        }
      }
    }
    return seen;
  }

  /** True when a placement is shown somewhere inside the branch of `rootId`. */
  inBranch(id: string, rootId: string): boolean {
    if (id === rootId) return true;
    const seen = new Set<string>([id]);
    const frontier = [id];
    while (frontier.length > 0) {
      const current = frontier.pop()!;
      const parentId = this.rows.get(current)?.parentId ?? null;
      if (parentId === null) continue;
      if (parentId === rootId) return true;
      for (const candidate of [parentId, ...this.copies(parentId).map((copy) => copy.id)]) {
        if (candidate === rootId) return true;
        if (!seen.has(candidate)) {
          seen.add(candidate);
          frontier.push(candidate);
        }
      }
    }
    return false;
  }

  /** How many levels the branch of `rootId` is shown from its top, upwards to `fromId`. */
  displayDistance(fromId: string, toId: string): number {
    if (fromId === toId) return 0;
    let frontier = [toId];
    const seen = new Set<string>(frontier);
    let distance = 0;
    while (frontier.length > 0) {
      distance += 1;
      const next: string[] = [];
      for (const current of frontier) {
        const parentId = this.rows.get(current)?.parentId ?? null;
        if (parentId === null) continue;
        for (const candidate of [parentId, ...this.copies(parentId).map((copy) => copy.id)]) {
          if (candidate === fromId) return distance;
          if (!seen.has(candidate)) {
            seen.add(candidate);
            next.push(candidate);
          }
        }
      }
      frontier = next;
    }
    return 0;
  }

  /** The number of levels shown below a placement. */
  displayHeight(row: BulletRow): number {
    let height = 0;
    for (const child of this.displayChildren(row)) {
      height = Math.max(height, 1 + this.displayHeight(child));
    }
    return height;
  }

  /** The placements of a branch in display order, depth first, copies expanded. */
  walk(rootId: string | null, baseDepth: number): DisplayNode[] {
    const nodes: DisplayNode[] = [];
    const push = (row: BulletRow, displayParentId: string | null, depth: number): void => {
      nodes.push({ row, displayParentId, depth });
      if (this.isPlaceholder(row)) return;
      for (const child of this.displayChildren(row)) push(child, row.id, depth + 1);
    };
    if (rootId === null) {
      for (const row of this.children(null)) push(row, null, baseDepth);
      return nodes;
    }
    const root = this.rows.get(rootId);
    if (root === undefined) return nodes;
    push(root, root.parentId, baseDepth);
    return nodes;
  }

  serialize(node: DisplayNode, parentOverride?: string | null): Bullet {
    const row = node.row;
    const original = this.original(row);
    const placeholder = original === undefined;
    return {
      id: row.id,
      parentId: parentOverride === undefined ? node.displayParentId : parentOverride,
      position: row.position,
      depth: node.depth,
      text: placeholder ? '' : original.text,
      completed: placeholder ? false : original.completed,
      collapsed: row.collapsed,
      date: placeholder ? null : original.date,
      tags: placeholder ? [] : [...original.tags],
      mentions: placeholder ? [] : [...original.mentions],
      mirrorOf: row.mirrorOf,
      placeholder,
      revision: placeholder ? 0 : original.revision,
      childCount: placeholder ? 0 : this.children(original.id).length
    };
  }
}

/** Loads every live placement of one outline. */
export async function loadTree(ownerId: string, client?: PoolClient): Promise<Tree> {
  const runner = client ?? pool;
  const result = await runner.query(
    `select ${ROW_COLUMNS} from bullets where owner_id = $1 and trashed_at is null`,
    [ownerId]
  );
  return new Tree((result.rows as RawRow[]).map(toBulletRow));
}

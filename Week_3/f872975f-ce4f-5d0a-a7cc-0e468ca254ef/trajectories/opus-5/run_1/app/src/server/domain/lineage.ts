import { LOCK_SCOPE_LINEAGE, Queryable, advisoryLock, rows } from '../db/pool';
import { BoardRow, boardMoney, loadBoard } from './boards';
import { RateBook } from './rates';

export async function rootTag(client: Queryable, tag: string): Promise<string> {
  const found = await rows<{ tag: string }>(
    client,
    `WITH RECURSIVE up AS (
       SELECT tag, parent_tag FROM boards WHERE tag = $1
       UNION ALL
       SELECT b.tag, b.parent_tag FROM boards b JOIN up ON up.parent_tag = b.tag
     )
     SELECT tag FROM up WHERE parent_tag IS NULL`,
    [tag]
  );
  return found[0]?.tag ?? tag;
}

/** Serialises corrections and hold claims within one lineage. */
export async function lockLineage(client: Queryable, tag: string): Promise<void> {
  await advisoryLock(client, LOCK_SCOPE_LINEAGE, await rootTag(client, tag));
}

export async function ancestorTags(client: Queryable, tag: string): Promise<string[]> {
  const found = await rows<{ tag: string; depth: number }>(
    client,
    `WITH RECURSIVE up AS (
       SELECT tag, parent_tag, 0 AS depth FROM boards WHERE tag = $1
       UNION ALL
       SELECT b.tag, b.parent_tag, up.depth + 1 FROM boards b JOIN up ON up.parent_tag = b.tag
     )
     SELECT tag, depth FROM up WHERE depth > 0 ORDER BY depth DESC`,
    [tag]
  );
  return found.map((row) => row.tag);
}

async function childrenOf(client: Queryable, tags: string[]): Promise<Map<string, BoardRow[]>> {
  const byParent = new Map<string, BoardRow[]>();
  if (tags.length === 0) return byParent;
  const found = await rows<BoardRow>(
    client,
    `SELECT b.tag, b.species, b.grade, b.status, b.lot_id, b.length_mm, b.width_mm, b.thickness_mm,
            b.defects, b.parent_tag, b.from_cut, b.cut_ticket_id, b.created_at,
            l.name AS lot_name, l.origin AS lot_origin, l.built_year AS lot_built_year
     FROM boards b JOIN lots l ON l.id = b.lot_id
     WHERE b.parent_tag = ANY($1::text[])
     ORDER BY b.created_at, b.tag`,
    [tags]
  );
  for (const row of found) {
    if (row.parent_tag === null) continue;
    const list = byParent.get(row.parent_tag) ?? [];
    list.push(row);
    byParent.set(row.parent_tag, list);
  }
  return byParent;
}

/** Every board below the given one, parent before child and siblings in creation order. */
export async function descendantsInOrder(client: Queryable, tag: string): Promise<BoardRow[]> {
  const ordered: BoardRow[] = [];
  let frontier = [tag];
  while (frontier.length > 0) {
    const children = await childrenOf(client, frontier);
    const next: BoardRow[] = [];
    for (const parent of frontier) {
      for (const child of children.get(parent) ?? []) next.push(child);
    }
    ordered.push(...next);
    frontier = next.map((row) => row.tag);
  }
  return ordered;
}

export interface LineageNode {
  tag: string;
  status: string;
  parent_tag: string | null;
  grade: string | null;
  length_mm: number;
  width_mm: number;
  thickness_mm: number;
  volume_mm3: number;
  board_feet: string;
  rate_cents: number | null;
  price_cents: number | null;
  longest_clear_mm: number;
  created_at: string;
  children: LineageNode[];
}

function nodeFor(board: BoardRow, rates: RateBook, children: LineageNode[]): LineageNode {
  const money = boardMoney(board, rates);
  return {
    tag: board.tag,
    status: board.status,
    parent_tag: board.parent_tag,
    grade: board.grade,
    length_mm: board.length_mm,
    width_mm: board.width_mm,
    thickness_mm: board.thickness_mm,
    volume_mm3: money.volume_mm3,
    board_feet: money.board_feet,
    rate_cents: money.rate_cents,
    price_cents: money.price_cents,
    longest_clear_mm: money.longest_clear_mm,
    created_at: board.created_at.toISOString(),
    children
  };
}

/**
 * The lineage from the root down: each ancestor carries only the child on the path, and the
 * requested board carries all its descendants.
 */
export async function lineageTree(client: Queryable, board: BoardRow, rates: RateBook): Promise<LineageNode> {
  const descendants = await descendantsInOrder(client, board.tag);
  const byParent = new Map<string, BoardRow[]>();
  for (const row of descendants) {
    if (row.parent_tag === null) continue;
    const list = byParent.get(row.parent_tag) ?? [];
    list.push(row);
    byParent.set(row.parent_tag, list);
  }
  const subtree = (row: BoardRow): LineageNode =>
    nodeFor(row, rates, (byParent.get(row.tag) ?? []).map(subtree));

  let node = subtree(board);
  const ancestors = await ancestorTags(client, board.tag);
  for (const ancestorTag of [...ancestors].reverse()) {
    const ancestor = await loadBoard(client, ancestorTag);
    if (ancestor === null) break;
    node = nodeFor(ancestor, rates, [node]);
  }
  return node;
}

export async function isSelfOrDescendant(client: Queryable, candidate: string, tag: string): Promise<boolean> {
  if (candidate === tag) return true;
  const descendants = await descendantsInOrder(client, tag);
  return descendants.some((row) => row.tag === candidate);
}

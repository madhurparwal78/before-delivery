import type { PoolClient } from 'pg';
import { recogniseDate } from '../shared/dates.js';
import { readMentions, readTags } from '../shared/tags.js';
import { today } from './config.js';
import { ROW_COLUMNS, toBulletRow, type BulletRow, type RawRow } from './tree.js';

/** The stored shape of one placement, used by history steps that restore rows. */
export interface SavedRow {
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

export async function readRow(client: PoolClient, id: string): Promise<BulletRow | null> {
  const result = await client.query(
    `select ${ROW_COLUMNS} from bullets where id = $1 and trashed_at is null`,
    [id]
  );
  const raw = result.rows[0] as RawRow | undefined;
  return raw === undefined ? null : toBulletRow(raw);
}

export async function closeGap(
  client: PoolClient,
  ownerId: string,
  parentId: string | null,
  position: number
): Promise<void> {
  await client.query(
    `update bullets set position = position - 1
      where owner_id = $1 and parent_id is not distinct from $2
        and trashed_at is null and position > $3`,
    [ownerId, parentId, position]
  );
}

export async function makeRoom(
  client: PoolClient,
  ownerId: string,
  parentId: string | null,
  index: number,
  exceptId: string | null = null
): Promise<void> {
  await client.query(
    `update bullets set position = position + 1
      where owner_id = $1 and parent_id is not distinct from $2
        and trashed_at is null and position >= $3 and id is distinct from $4`,
    [ownerId, parentId, index, exceptId]
  );
}

/** Puts one parent's children back on 0..n-1 after rows have come and gone. */
export async function renumber(
  client: PoolClient,
  ownerId: string,
  parentId: string | null
): Promise<void> {
  await client.query(
    `with ordered as (
       select id, (row_number() over (order by position, id) - 1) as rank
         from bullets
        where owner_id = $1 and parent_id is not distinct from $2 and trashed_at is null)
     update bullets set position = ordered.rank
       from ordered where bullets.id = ordered.id and bullets.position <> ordered.rank`,
    [ownerId, parentId]
  );
}

/** Moves a placement to an exact parent and index, closing and opening the gaps. */
export async function placeAt(
  client: PoolClient,
  row: BulletRow,
  parentId: string | null,
  index: number
): Promise<void> {
  await closeGap(client, row.ownerId, row.parentId, row.position);
  await makeRoom(client, row.ownerId, parentId, index, row.id);
  await client.query(`update bullets set parent_id = $2, position = $3 where id = $1`, [
    row.id,
    parentId,
    index
  ]);
}

export async function insertRow(client: PoolClient, row: SavedRow): Promise<void> {
  await makeRoom(client, row.ownerId, row.parentId, row.position);
  await client.query(
    `insert into bullets (id, owner_id, parent_id, position, text, completed, collapsed, date,
                          tags, mentions, mirror_of, revision, revision_author)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      row.id,
      row.ownerId,
      row.parentId,
      row.position,
      row.text,
      row.completed,
      row.collapsed,
      row.date,
      row.tags,
      row.mentions,
      row.mirrorOf,
      row.revision,
      row.revisionAuthor
    ]
  );
}

export async function expand(client: PoolClient, id: string): Promise<void> {
  await client.query(`update bullets set collapsed = false where id = $1`, [id]);
}

export interface TextFields {
  text: string;
  date: string | null;
  tags: string[];
  mentions: string[];
}

/** Reads a saved text: the first recognised date token is rewritten and stored. */
export function readTextFields(raw: string): TextFields {
  const recognised = recogniseDate(raw, today());
  return {
    text: recognised.text,
    date: recognised.date,
    tags: readTags(recognised.text),
    mentions: readMentions(recognised.text)
  };
}

export async function writeText(
  client: PoolClient,
  id: string,
  fields: TextFields,
  authorId: string
): Promise<number> {
  const result = await client.query(
    `update bullets set text = $2, date = $3, tags = $4, mentions = $5,
            revision = revision + 1, revision_author = $6
      where id = $1 returning revision`,
    [id, fields.text, fields.date, fields.tags, fields.mentions, authorId]
  );
  return (result.rows[0] as { revision: number }).revision;
}

export async function writeCompleted(
  client: PoolClient,
  id: string,
  completed: boolean,
  authorId: string
): Promise<number> {
  const result = await client.query(
    `update bullets set completed = $2, revision = revision + 1, revision_author = $3
      where id = $1 returning revision`,
    [id, completed, authorId]
  );
  return (result.rows[0] as { revision: number }).revision;
}

export async function writeCollapsed(
  client: PoolClient,
  id: string,
  collapsed: boolean
): Promise<void> {
  await client.query(`update bullets set collapsed = $2 where id = $1`, [id, collapsed]);
}

/** Every live placement inside a branch, through real parents, including the branch root. */
export async function subtreeIds(client: PoolClient, rootId: string): Promise<string[]> {
  const result = await client.query(
    `with recursive branch as (
       select id from bullets where id = $1 and trashed_at is null
       union all
       select b.id from bullets b join branch on b.parent_id = branch.id
        where b.trashed_at is null
     )
     select id from branch`,
    [rootId]
  );
  return (result.rows as Array<{ id: string }>).map((row) => row.id);
}

export async function trashRows(
  client: PoolClient,
  ids: readonly string[],
  trashSeconds: number
): Promise<void> {
  await client.query(
    `update bullets set trashed_at = now(), purge_at = now() + make_interval(secs => $2)
      where id = any($1::text[])`,
    [ids, trashSeconds]
  );
}

export async function restoreRows(client: PoolClient, ids: readonly string[]): Promise<void> {
  await client.query(
    `update bullets set trashed_at = null, purge_at = null where id = any($1::text[])`,
    [ids]
  );
}

export async function deleteRows(client: PoolClient, ids: readonly string[]): Promise<void> {
  await client.query(`delete from bullets where id = any($1::text[])`, [ids]);
}

export function savedRowOf(row: BulletRow): SavedRow {
  return { ...row };
}

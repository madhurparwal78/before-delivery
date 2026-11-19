import type { Queryable } from '../db.js';
import type { BoardOrder, Pin, ReactionType, Visibility } from '../../shared/types.js';
import { sourceHost } from '../../shared/text.js';
import { isoRequired } from '../clock.js';

interface PinRow {
  id: number;
  version: number;
  title: string;
  description: string;
  alt: string;
  source: string | null;
  position: number;
  created_at: Date;
  owner_id: number;
  board_id: number;
  section_id: number | null;
  root_pin_id: number | null;
  state: string;
  owner_name: string;
  owner_handle: string;
  board_name: string;
  board_visibility: Visibility;
  section_name: string | null;
  image_width: number;
  image_height: number;
  sha256: string;
  variants: number[];
  root_user_name: string | null;
  root_state: string | null;
  root_board_visibility: Visibility | null;
  root_board_owner_id: number | null;
  root_member: boolean | null;
  saves: number;
  comments: number;
  reactions: number;
  my_reaction: ReactionType | null;
}

const PIN_SELECT = `
  select p.id, p.version, p.title, p.description, p.alt, p.source, p.position, p.created_at,
         p.owner_id, p.board_id, p.section_id, p.root_pin_id, p.state,
         o.name as owner_name, o.handle as owner_handle,
         b.name as board_name, b.visibility as board_visibility,
         s.name as section_name,
         i.width as image_width, i.height as image_height, i.sha256, i.variants,
         ru.name as root_user_name, rp.state as root_state,
         rb.visibility as root_board_visibility, rb.owner_id as root_board_owner_id,
         exists (select 1 from board_members m where m.board_id = rb.id and m.user_id = $1) as root_member,
         (select count(*)::int from pins sp
            join boards sb on sb.id = sp.board_id
           where sp.root_pin_id = p.id and sp.state = 'live'
             and sb.visibility = 'public' and sb.deleted_at is null) as saves,
         (select count(*)::int from comments c where c.pin_id = p.id and c.deleted = false) as comments,
         (select count(*)::int from reactions r where r.pin_id = p.id) as reactions,
         (select r.type from reactions r where r.pin_id = p.id and r.user_id = $1) as my_reaction
    from pins p
    join users o on o.id = p.owner_id
    join boards b on b.id = p.board_id
    join images i on i.id = p.image_id
    left join sections s on s.id = p.section_id
    left join pins rp on rp.id = p.root_pin_id
    left join users ru on ru.id = rp.owner_id
    left join boards rb on rb.id = rp.board_id`;

function serialize(row: PinRow, tags: string[], viewerId: number): Pin {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    description: row.description,
    alt: row.alt,
    source: row.source,
    source_host: row.source ? sourceHost(row.source) : null,
    tags,
    owner: { id: row.owner_id, name: row.owner_name, handle: row.owner_handle },
    board: { id: row.board_id, name: row.board_name, visibility: row.board_visibility },
    section:
      row.section_id === null || row.section_name === null
        ? null
        : { id: row.section_id, name: row.section_name },
    position: row.position,
    image: {
      width: row.image_width,
      height: row.image_height,
      sha256: row.sha256,
      variants: row.variants.map((width) => ({ width, url: `/media/${row.id}/${width}` })),
      original_url: `/media/${row.id}/original`,
    },
    saved_from: savedFrom(row, viewerId),
    saves: row.saves,
    comments: row.comments,
    reactions: row.reactions,
    my_reaction: row.my_reaction,
    created_at: isoRequired(row.created_at),
  };
}

/** The one credit-line rule, decided in this order. */
function savedFrom(row: PinRow, viewerId: number): Pin['saved_from'] {
  if (row.root_pin_id === null || row.root_user_name === null) return null;
  const hidden =
    row.root_board_visibility === 'secret' &&
    row.root_board_owner_id !== viewerId &&
    row.root_member !== true;
  if (hidden) return { pin_id: null, user_name: row.root_user_name, removed: false };
  if (row.root_state !== 'live') return { pin_id: null, user_name: row.root_user_name, removed: true };
  return { pin_id: row.root_pin_id, user_name: row.root_user_name, removed: false };
}

export async function loadPins(
  db: Queryable,
  ids: number[],
  viewerId: number,
): Promise<Map<number, Pin>> {
  if (ids.length === 0) return new Map();
  const rows = await db.query<PinRow>(`${PIN_SELECT} where p.id = any($2::bigint[])`, [
    viewerId,
    ids,
  ]);
  const tagRows = await db.query<{ pin_id: number; tag: string }>(
    'select pin_id, tag from pin_tags where pin_id = any($1::bigint[]) order by pin_id, ord',
    [ids],
  );
  const tags = new Map<number, string[]>();
  for (const row of tagRows.rows) {
    const list = tags.get(row.pin_id) ?? [];
    list.push(row.tag);
    tags.set(row.pin_id, list);
  }
  const pins = new Map<number, Pin>();
  for (const row of rows.rows) {
    pins.set(row.id, serialize(row, tags.get(row.id) ?? [], viewerId));
  }
  return pins;
}

export async function loadPinsInOrder(
  db: Queryable,
  ids: number[],
  viewerId: number,
): Promise<Pin[]> {
  const pins = await loadPins(db, ids, viewerId);
  return ids.map((id) => pins.get(id)).filter((pin): pin is Pin => pin !== undefined);
}

export async function boardOrder(db: Queryable, boardId: number): Promise<BoardOrder> {
  const pins = await db.query<{ id: number; section_id: number | null }>(
    `select id, section_id from pins
      where board_id = $1 and state = 'live'
      order by position, id`,
    [boardId],
  );
  const sections = await db.query<{ id: number; name: string }>(
    `select id, name from sections where board_id = $1 and deleted_at is null order by position, id`,
    [boardId],
  );
  const unsectioned = pins.rows.filter((row) => row.section_id === null).map((row) => row.id);
  return {
    unsectioned,
    sections: sections.rows.map((section) => ({
      id: section.id,
      name: section.name,
      pins: pins.rows.filter((row) => row.section_id === section.id).map((row) => row.id),
    })),
  };
}

export function orderedPinIds(order: BoardOrder): number[] {
  return [...order.unsectioned, ...order.sections.flatMap((section) => section.pins)];
}

export async function pinCount(db: Queryable, boardId: number): Promise<number> {
  const result = await db.query<{ n: number }>(
    `select count(*)::int as n from pins where board_id = $1 and state = 'live'`,
    [boardId],
  );
  return result.rows[0]?.n ?? 0;
}

/** The board cover rule: the chosen pin while it is on the board, else the first pin. */
export async function coverPinId(
  db: Queryable,
  boardId: number,
  chosen: number | null,
): Promise<number | null> {
  if (chosen !== null) {
    const kept = await db.query<{ id: number }>(
      `select id from pins where id = $1 and board_id = $2 and state = 'live'`,
      [chosen, boardId],
    );
    if (kept.rows[0]) return kept.rows[0].id;
  }
  const order = await boardOrder(db, boardId);
  if (order.unsectioned.length > 0) return order.unsectioned[0];
  for (const section of order.sections) {
    if (section.pins.length > 0) return section.pins[0];
  }
  return null;
}

export async function containerCount(
  db: Queryable,
  boardId: number,
  sectionId: number | null,
): Promise<number> {
  const result = await db.query<{ n: number }>(
    `select count(*)::int as n from pins
      where board_id = $1 and section_id is not distinct from $2 and state = 'live'`,
    [boardId, sectionId],
  );
  return result.rows[0]?.n ?? 0;
}

/** Positions are 1..n with no gaps inside every container. */
export async function renumber(
  db: Queryable,
  boardId: number,
  sectionId: number | null,
): Promise<void> {
  await db.query(
    `update pins set position = ranked.rn
       from (select id, row_number() over (order by position, id) as rn
               from pins
              where board_id = $1 and section_id is not distinct from $2 and state = 'live') ranked
      where pins.id = ranked.id and pins.position <> ranked.rn`,
    [boardId, sectionId],
  );
}

export async function makeRoom(
  db: Queryable,
  boardId: number,
  sectionId: number | null,
  count: number,
): Promise<void> {
  await db.query(
    `update pins set position = position + $3
      where board_id = $1 and section_id is not distinct from $2 and state = 'live'`,
    [boardId, sectionId, count],
  );
}

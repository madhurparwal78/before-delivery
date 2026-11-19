import { commentsCountSql, emitCounts, reactionsCountSql, rootSql, rootsOf, savesCountSql } from "./counts.js";
import { authorize, loadBoard, visibleBoardSql, visiblePinSql } from "./access.js";
import { containerOf } from "../shared/order.js";
import { loadOrder, lockBoards, recordChange, renumber, type Actor } from "./containers.js";
import { iso, now } from "./clock.js";
import { exactlyOne, one, pool, rows, tx, type Db } from "./db.js";
import { conflict, forbidden, notFound, validation } from "./errors.js";
import { emit } from "./events.js";
import { extractTags, searchWordsOf, sourceHost, validatePinText, type PinText } from "./text.js";
import type { Pin, ReactionType, Visibility } from "../shared/types.js";

interface PinRow {
  id: number;
  version: number;
  title: string;
  description: string;
  alt: string;
  source: string | null;
  tags: string[];
  position: number;
  created_at: Date;
  owner_id: number;
  owner_name: string;
  owner_handle: string;
  board_id: number;
  board_name: string;
  board_visibility: Visibility;
  section_id: number | null;
  section_name: string | null;
  width: number;
  height: number;
  sha256: string;
  variants: number[];
  saved_from: number | null;
  root_owner_name: string | null;
  root_state: string | null;
  root_visible: boolean | null;
  saves: number;
  comments: number;
  reactions: number;
  my_reaction: ReactionType | null;
}

const PIN_SELECT = `
  SELECT p.id, p.version, p.title, p.description, p.alt, p.source, p.tags, p.position, p.created_at, p.saved_from,
         o.id AS owner_id, o.name AS owner_name, o.handle AS owner_handle,
         b.id AS board_id, b.name AS board_name, b.visibility AS board_visibility,
         s.id AS section_id, s.name AS section_name,
         i.width, i.height, i.sha256, i.variants,
         ro.name AS root_owner_name, r.state AS root_state,
         CASE WHEN r.id IS NULL THEN NULL
              WHEN rb.id IS NULL THEN (r.vanished_viewers IS NULL OR $1 = ANY(r.vanished_viewers))
              ELSE ${visibleBoardSql("rb", "$1")} END AS root_visible,
         ${savesCountSql("p")} AS saves, ${commentsCountSql("p")} AS comments, ${reactionsCountSql("p")} AS reactions,
         (SELECT x.type FROM reactions x WHERE x.pin_id = p.id AND x.user_id = $1) AS my_reaction
    FROM pins p
    JOIN users o ON o.id = p.owner_id
    JOIN images i ON i.id = p.image_id
    LEFT JOIN boards b ON b.id = p.board_id
    LEFT JOIN sections s ON s.id = p.section_id
    LEFT JOIN pins r ON r.id = p.saved_from
    LEFT JOIN users ro ON ro.id = r.owner_id
    LEFT JOIN boards rb ON rb.id = r.board_id`;

/** The credit a viewer gets for a save: plain text, "original removed", or a link. */
function creditOf(row: PinRow): Pin["saved_from"] {
  if (row.saved_from === null) return null;
  const user_name = row.root_owner_name ?? "";
  if (!row.root_visible) return { pin_id: null, user_name, removed: false };
  if (row.root_state !== "live") return { pin_id: null, user_name, removed: true };
  return { pin_id: row.saved_from, user_name, removed: false };
}

function toPin(row: PinRow): Pin {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    description: row.description,
    alt: row.alt,
    source: row.source,
    source_host: row.source === null ? null : sourceHost(row.source),
    tags: row.tags,
    owner: { id: row.owner_id, name: row.owner_name, handle: row.owner_handle },
    board: { id: row.board_id, name: row.board_name, visibility: row.board_visibility },
    section: row.section_id === null ? null : { id: row.section_id, name: row.section_name ?? "" },
    position: row.position,
    image: {
      width: row.width,
      height: row.height,
      sha256: row.sha256,
      variants: [...row.variants].sort((a, b) => a - b).map((width) => ({ width, url: `/media/${row.id}/${width}` })),
      original_url: `/media/${row.id}/original`,
    },
    saved_from: creditOf(row),
    saves: row.saves,
    comments: row.comments,
    reactions: row.reactions,
    my_reaction: row.my_reaction,
    created_at: iso(row.created_at),
  };
}

/** Live pins the viewer may see that satisfy `where`. `$1` is the viewer; extra parameters start at `$2`. */
export async function selectPins(
  db: Db,
  viewerId: number,
  where: string,
  params: unknown[] = [],
  orderBy = "p.created_at DESC, p.id ASC",
  limit = 10_000,
): Promise<Pin[]> {
  const found = await rows<PinRow>(
    db,
    `${PIN_SELECT} WHERE ${visiblePinSql("p", "b", "$1")} AND (${where}) ORDER BY ${orderBy} LIMIT ${limit}`,
    [viewerId, ...params],
  );
  return found.map(toPin);
}

export async function getPin(db: Db, viewerId: number, pinId: number): Promise<Pin> {
  const [pin] = await selectPins(db, viewerId, "p.id = $2", [pinId]);
  if (!pin) throw notFound();
  return pin;
}

interface NewPin {
  ownerId: number;
  boardId: number;
  sectionId: number | null;
  imageId: string;
  text: PinText;
  savedFrom: number | null;
  createdAt: Date;
  position: number;
}

/** Inserts a live pin. A position below 1 puts it first; `renumber` closes the container afterwards. */
export async function insertPin(db: Db, pin: NewPin): Promise<number> {
  const tags = extractTags(pin.text.title, pin.text.description);
  const row = await exactlyOne<{ id: number }>(
    db,
    `INSERT INTO pins (owner_id, board_id, section_id, position, image_id, title, description, alt, source, tags, search_words, saved_from, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [
      pin.ownerId, pin.boardId, pin.sectionId, pin.position, pin.imageId, pin.text.title, pin.text.description, pin.text.alt,
      pin.text.source, tags, searchWordsOf(pin.text.title, pin.text.description, tags), pin.savedFrom, pin.createdAt,
    ],
  );
  return row.id;
}

/** A new pin, save or copy puts a pin onto a board: the board's "last saved to" moves to now. */
export async function touchLastSaved(db: Db, boardId: number, at: Date): Promise<void> {
  await db.query("UPDATE boards SET last_saved_at = $2 WHERE id = $1", [boardId, at]);
}

/** After new live pins appear: tell open feeds, and refresh the saves counts of their roots. */
export async function announceNewPins(db: Db, pinIds: number[]): Promise<void> {
  await emit(db, { kind: "feed", pinIds }, { type: "feed", pin_ids: pinIds });
  await emitCounts(db, await rootsOf(db, pinIds));
}

export async function editPin(actor: Actor, pinId: number, input: {
  version: unknown;
  fields: { title?: unknown; description?: unknown; alt?: unknown; source?: unknown };
}): Promise<Pin> {
  return tx(async (client) => {
    const located = await one<{ board_id: number }>(
      client,
      `SELECT p.board_id FROM pins p LEFT JOIN boards b ON b.id = p.board_id WHERE p.id = $2 AND ${visiblePinSql("p", "b", "$1")}`,
      [actor.id, pinId],
    );
    if (!located) throw notFound();
    await lockBoards(client, [located.board_id]);
    const found = await one<{ owner_id: number; version: number }>(
      client,
      `SELECT p.owner_id, p.version FROM pins p LEFT JOIN boards b ON b.id = p.board_id
        WHERE p.id = $2 AND ${visiblePinSql("p", "b", "$1")} FOR UPDATE OF p`,
      [actor.id, pinId],
    );
    if (!found) throw notFound();
    if (found.owner_id !== actor.id) throw forbidden();
    const current = await getPin(client, actor.id, pinId);
    if (typeof input.version !== "number" || !Number.isSafeInteger(input.version)) throw validation("version");
    if (input.version !== found.version) throw conflict("version_conflict", { current });
    const text = validatePinText({
      title: input.fields.title ?? current.title,
      description: input.fields.description ?? current.description,
      alt: input.fields.alt ?? current.alt,
      source: input.fields.source === undefined ? current.source : input.fields.source,
    });
    const tags = extractTags(text.title, text.description);
    await client.query(
      `UPDATE pins SET title = $2, description = $3, alt = $4, source = $5, tags = $6, search_words = $7, version = version + 1 WHERE id = $1`,
      [pinId, text.title, text.description, text.alt, text.source, tags, searchWordsOf(text.title, text.description, tags)],
    );
    const updated = await getPin(client, actor.id, pinId);
    await recordChange(client, located.board_id, actor, "updated", { id: pinId, title: updated.title }, null);
    await emit(client, { kind: "pin", pin: pinId }, { type: "pin_changed", pin_id: pinId, version: updated.version });
    return updated;
  });
}

/** What a credited copy (a save or a bulk copy) takes from the pin it copies. */
interface CreditSource {
  title: string;
  description: string;
  alt: string;
  source: string | null;
  image_id: string;
  root: number;
}

export async function creditSources(db: Db, pinIds: number[]): Promise<Map<number, CreditSource>> {
  const found = await rows<CreditSource & { id: number }>(
    db,
    `SELECT p.id, p.title, p.description, p.alt, p.source, p.image_id, ${rootSql("p")} AS root FROM pins p WHERE p.id = ANY($1)`,
    [pinIds],
  );
  return new Map(found.map((row) => [row.id, row]));
}

/** One per board: does the board already hold a live pin that is, or credits, one of these root originals (apart from `except`)? */
export async function holdsRoot(db: Db, boardId: number, roots: number[], except: number[] = []): Promise<boolean> {
  const held = await one(
    db,
    `SELECT 1 FROM pins p WHERE p.board_id = $1 AND p.state = 'live' AND ${rootSql("p")} = ANY($2) AND NOT (p.id = ANY($3))`,
    [boardId, roots, except],
  );
  return held !== null;
}

/**
 * Adds credited copies at the front of a container, owned by the actor, sharing the original's image.
 * Renumbers, moves "last saved to", and tells open feeds. Returns the new pin ids in the order given.
 */
export async function addCredited(
  db: Db,
  args: { actor: Actor; boardId: number; sectionId: number | null; sources: CreditSource[]; at: Date },
): Promise<number[]> {
  const created: number[] = [];
  for (const [index, source] of args.sources.entries()) {
    created.push(
      await insertPin(db, {
        ownerId: args.actor.id,
        boardId: args.boardId,
        sectionId: args.sectionId,
        imageId: source.image_id,
        text: { title: source.title, description: source.description, alt: source.alt, source: source.source },
        savedFrom: source.root,
        createdAt: args.at,
        position: index - COPY_FRONT_OFFSET,
      }),
    );
  }
  await renumber(db, args.boardId);
  await touchLastSaved(db, args.boardId, args.at);
  await announceNewPins(db, created);
  return created;
}

const COPY_FRONT_OFFSET = 1_000_000;

/** Saves a pin onto a board as a new pin owned by the saver that credits the root original. */
export async function savePin(actor: Actor, pinId: number, targetBoardId: number, sectionId: number | null): Promise<Pin> {
  return tx(async (client) => {
    await getPin(client, actor.id, pinId);
    const board = await loadBoard(client, targetBoardId, actor.id, true);
    authorize(board, "edit_pins");
    if (sectionId !== null && containerOf(await loadOrder(client, board.id), sectionId) === null) throw notFound();
    const source = (await creditSources(client, [pinId])).get(pinId);
    if (!source) throw notFound();
    if (await holdsRoot(client, board.id, [source.root])) throw conflict("already_on_board", { board: { id: board.id, name: board.name } });
    const [created] = await addCredited(client, { actor, boardId: board.id, sectionId, sources: [source], at: now() });
    if (created === undefined) throw notFound();
    const saved = await getPin(client, actor.id, created);
    await recordChange(client, board.id, actor, "added", { id: created, title: saved.title }, saved.section);
    return saved;
  });
}

export async function suggestTags(viewerId: number, prefix: string): Promise<{ tag: string; count: number }[]> {
  return rows<{ tag: string; count: number }>(
    pool,
    `SELECT t AS tag, count(*)::int AS count
       FROM pins p JOIN boards b ON b.id = p.board_id, unnest(p.tags) AS t
      WHERE p.owner_id = $1 AND ${visiblePinSql("p", "b", "$1")} AND starts_with(t, $2)
      GROUP BY t ORDER BY count(*) DESC, t ASC LIMIT 5`,
    [viewerId, prefix.toLowerCase()],
  );
}

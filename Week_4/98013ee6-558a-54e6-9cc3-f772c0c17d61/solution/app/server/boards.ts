import { authorize, loadBoard } from "./access.js";
import { memberRolesAllowing } from "../shared/roles.js";
import { boardFollowersSql, emitCounts, pinCountSql } from "./counts.js";
import { containerOf, coverOf, flatten, removeFromOrder } from "../shared/order.js";
import { loadOrder, recordChange, writeOrder, type Actor } from "./containers.js";
import { iso, now } from "./clock.js";
import { Body } from "./http.js";
import { exactlyOne, isUniqueViolation, one, pool, rows, tx, type Db } from "./db.js";
import { conflict, notFound, validation } from "./errors.js";
import { emit } from "./events.js";
import { selectPins } from "./pins.js";
import { validateName, wordsOf } from "./text.js";
import type { Board, BoardCard, BoardOrder, BoardSummary, Visibility } from "../shared/types.js";

interface BoardRow {
  id: number;
  name: string;
  visibility: Visibility;
  seq: number;
  cover_pin_id: number | null;
  created_at: Date;
  last_saved_at: Date | null;
  owner_id: number;
  owner_name: string;
  owner_handle: string;
  pin_count: number;
  followers: number;
  following: boolean;
}

export async function getBoard(db: Db, viewerId: number, boardId: number): Promise<Board> {
  const access = await loadBoard(db, boardId, viewerId);
  const row = await one<BoardRow>(
    db,
    `SELECT b.id, b.name, b.visibility, b.seq, b.cover_pin_id, b.created_at, b.last_saved_at,
            o.id AS owner_id, o.name AS owner_name, o.handle AS owner_handle,
            ${pinCountSql("b.id")} AS pin_count, ${boardFollowersSql("b.id")} AS followers,
            EXISTS (SELECT 1 FROM board_follows f WHERE f.board_id = b.id AND f.follower_id = $2) AS following
       FROM boards b JOIN users o ON o.id = b.owner_id WHERE b.id = $1`,
    [boardId, viewerId],
  );
  if (!row) throw notFound();
  const order = await loadOrder(db, boardId);
  const pins = await selectPins(db, viewerId, "p.board_id = $2", [boardId], "p.id");
  const byId = new Map(pins.map((pin) => [pin.id, pin]));
  const ordered = flatten(order).flatMap((id) => {
    const pin = byId.get(id);
    return pin ? [pin] : [];
  });
  return {
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    owner: { id: row.owner_id, name: row.owner_name, handle: row.owner_handle },
    role: access.role,
    seq: row.seq,
    pin_count: row.pin_count,
    followers: row.followers,
    following: row.following,
    cover: coverOf(order, row.cover_pin_id),
    created_at: iso(row.created_at),
    last_saved_at: row.last_saved_at ? iso(row.last_saved_at) : null,
    order,
    pins: ordered,
  };
}

const DISPLAY_WIDTH = 474;

/** Each board's cover as the picture shown on a card: the pin and a display-sized image link. */
export async function coversOf(db: Db, boards: { id: number; cover_pin_id: number | null }[]): Promise<Map<number, { pin_id: number; url: string } | null>> {
  const chosen = new Map<number, number | null>();
  for (const board of boards) chosen.set(board.id, coverOf(await loadOrder(db, board.id), board.cover_pin_id));
  const pinIds = [...chosen.values()].flatMap((id) => (id === null ? [] : [id]));
  const widths = new Map(
    (await rows<{ id: number; width: number }>(db, "SELECT p.id, i.width FROM pins p JOIN images i ON i.id = p.image_id WHERE p.id = ANY($1)", [pinIds])).map((row) => [row.id, row.width]),
  );
  return new Map(
    [...chosen].map(([boardId, pinId]) => [
      boardId,
      pinId === null ? null : { pin_id: pinId, url: `/media/${pinId}/${(widths.get(pinId) ?? 0) >= DISPLAY_WIDTH ? DISPLAY_WIDTH : "original"}` },
    ]),
  );
}

/** Boards the viewer can add pins to (owned or edited), or with `all` every board they own or belong to, in the "last saved to" order. */
export async function boardsFor(db: Db, viewerId: number, typed: string, all: boolean): Promise<BoardCard[]> {
  const found = await rows<BoardSummary & { cover_pin_id: number | null }>(
    db,
    `SELECT b.id, b.name, b.visibility, b.cover_pin_id,
            ${pinCountSql("b.id")} AS pin_count
       FROM boards b
      WHERE b.owner_id = $1 OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.user_id = $1 AND ($2 OR m.role = ANY($3)))
      ORDER BY b.last_saved_at DESC NULLS LAST, b.id ASC`,
    [viewerId, all, memberRolesAllowing("edit_pins")],
  );
  const wanted = wordsOf(typed);
  const matching = found.filter((board) => {
    const words = wordsOf(board.name);
    return wanted.every((word) => words.some((candidate) => candidate.startsWith(word)));
  });
  const covers = all ? await coversOf(db, matching) : new Map<number, { pin_id: number; url: string } | null>();
  return matching.map((board) => ({ id: board.id, name: board.name, visibility: board.visibility, pin_count: board.pin_count, cover: covers.get(board.id) ?? null }));
}

async function nameTaken(db: Db, ownerId: number, name: string, exceptBoard: number | null): Promise<boolean> {
  const row = await one(db, "SELECT 1 FROM boards WHERE owner_id = $1 AND lower(name) = lower($2) AND ($3::bigint IS NULL OR id <> $3)", [ownerId, name, exceptBoard]);
  return row !== null;
}

function visibilityOf(value: unknown): Visibility {
  if (value !== "public" && value !== "secret") throw validation("visibility");
  return value;
}

export async function createBoard(ownerId: number, body: Body): Promise<Board> {
  const raw = body.get("name");
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed !== "" && (await nameTaken(pool, ownerId, trimmed, null))) throw conflict("board_name_taken");
  const name = validateName(raw);
  const visibility = visibilityOf(body.get("visibility"));
  const created = await exactlyOne<{ id: number }>(
    pool,
    "INSERT INTO boards (owner_id, name, visibility, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
    [ownerId, name, visibility, now()],
  ).catch((error: unknown) => {
    throw isUniqueViolation(error) ? conflict("board_name_taken") : error;
  });
  return getBoard(pool, ownerId, created.id);
}

export async function updateBoard(actor: Actor, boardId: number, body: Body): Promise<Board> {
  await tx(async (client) => {
    const access = await loadBoard(client, boardId, actor.id, true);
    authorize(access, "edit_board");
    let name = access.name;
    if (body.has("name")) {
      const raw = body.get("name");
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      if (trimmed !== "" && (await nameTaken(client, access.ownerId, trimmed, access.id))) throw conflict("board_name_taken");
      name = validateName(raw);
    }
    const visibility = body.has("visibility") ? visibilityOf(body.get("visibility")) : access.visibility;
    let cover = access.coverPinId;
    if (body.has("cover")) {
      const chosen = body.integerOrNull("cover");
      if (chosen !== null && !flatten(await loadOrder(client, access.id)).includes(chosen)) throw validation("cover");
      cover = chosen;
    }
    await client.query("UPDATE boards SET name = $2, visibility = $3, cover_pin_id = $4 WHERE id = $1", [access.id, name, visibility, cover]).catch((error: unknown) => {
      throw isUniqueViolation(error) ? conflict("board_name_taken") : error;
    });
    await recordChange(client, access.id, actor, "updated", null, null);
    if (visibility !== access.visibility) await emitCounts(client, await savedRootsOn(client, access.id));
  });
  return getBoard(pool, actor.id, boardId);
}

async function savedRootsOn(db: Db, boardId: number): Promise<number[]> {
  const found = await rows<{ root: number }>(db, "SELECT DISTINCT saved_from AS root FROM pins WHERE board_id = $1 AND state = 'live' AND saved_from IS NOT NULL", [boardId]);
  return found.map((row) => row.root);
}

export async function deleteBoard(viewerId: number, boardId: number): Promise<void> {
  await tx(async (client) => {
    const access = await loadBoard(client, boardId, viewerId, true);
    authorize(access, "edit_board");
    const people = await rows<{ user_id: number }>(
      client,
      "SELECT owner_id AS user_id FROM boards WHERE id = $1 UNION SELECT user_id FROM board_members WHERE board_id = $1",
      [boardId],
    );
    const roots = await savedRootsOn(client, boardId);
    await client.query(
      `UPDATE pins SET state = 'gone', vanished_viewers = $2, board_id = NULL, section_id = NULL, position = NULL
        WHERE board_id = $1 AND state IN ('live', 'deleted')`,
      [boardId, access.visibility === "secret" ? people.map((person) => person.user_id) : null],
    );
    await client.query("DELETE FROM presence WHERE board_id = $1", [boardId]);
    await client.query("DELETE FROM boards WHERE id = $1", [boardId]);
    await emitCounts(client, roots);
    for (const person of people) {
      await emit(client, { kind: "person", user: person.user_id }, { type: "membership", board_id: boardId, role: null });
    }
  });
}

export async function addSection(actor: Actor, boardId: number, rawName: unknown): Promise<{ id: number; name: string; position: number }> {
  return tx(async (client) => {
    const access = await loadBoard(client, boardId, actor.id, true);
    authorize(access, "edit_pins");
    const trimmed = typeof rawName === "string" ? rawName.trim() : "";
    if (trimmed !== "" && (await sectionNameTaken(client, boardId, trimmed, null))) throw conflict("section_name_taken");
    const name = validateName(rawName);
    const { next: position } = await exactlyOne<{ next: number }>(client, "SELECT COALESCE(max(position), 0)::int + 1 AS next FROM sections WHERE board_id = $1", [boardId]);
    const section = await exactlyOne<{ id: number }>(client, "INSERT INTO sections (board_id, name, position) VALUES ($1, $2, $3) RETURNING id", [boardId, name, position]).catch((error: unknown) => {
      throw isUniqueViolation(error) ? conflict("section_name_taken") : error;
    });
    await recordChange(client, boardId, actor, "section_added", null, { id: section.id, name });
    return { id: section.id, name, position };
  });
}

async function sectionNameTaken(db: Db, boardId: number, name: string, except: number | null): Promise<boolean> {
  return (await one(db, "SELECT 1 FROM sections WHERE board_id = $1 AND lower(name) = lower($2) AND ($3::bigint IS NULL OR id <> $3)", [boardId, name, except])) !== null;
}

export async function renameSection(actor: Actor, sectionId: number, rawName: unknown): Promise<{ id: number; name: string; position: number }> {
  return tx(async (client) => {
    const found = await one<{ board_id: number }>(client, "SELECT board_id FROM sections WHERE id = $1", [sectionId]);
    if (!found) throw notFound();
    const access = await loadBoard(client, found.board_id, actor.id, true);
    authorize(access, "edit_pins");
    const trimmed = typeof rawName === "string" ? rawName.trim() : "";
    if (trimmed !== "" && (await sectionNameTaken(client, access.id, trimmed, sectionId))) throw conflict("section_name_taken");
    const name = validateName(rawName);
    const updated = await exactlyOne<{ position: number }>(client, "UPDATE sections SET name = $2 WHERE id = $1 RETURNING position", [sectionId, name]).catch((error: unknown) => {
      throw isUniqueViolation(error) ? conflict("section_name_taken") : error;
    });
    await recordChange(client, access.id, actor, "section_renamed", null, { id: sectionId, name });
    return { id: sectionId, name, position: updated.position };
  });
}

interface MoveResult {
  seq: number;
  rebased: boolean;
  order: BoardOrder;
}

/** One pin or one section moves to a position; it is always applied to the board's current order. */
export async function moveItem(actor: Actor, boardId: number, body: Body): Promise<MoveResult> {
  return tx(async (client) => {
    const access = await loadBoard(client, boardId, actor.id, true);
    const order = await loadOrder(client, boardId);
    const kind = body.get("kind");
    const id = body.get("id");
    const targetSection = body.get("section");
    // Records named in the body come first (404), then the role (403), then the values (422).
    if (kind === "pin" && typeof id === "number" && !flatten(order).includes(id)) throw notFound();
    if (kind === "pin" && typeof targetSection === "number" && containerOf(order, targetSection) === null) throw notFound();
    if (kind === "section" && typeof id === "number" && !order.sections.some((section) => section.id === id)) throw notFound();
    authorize(access, "edit_pins");
    if (kind !== "pin" && kind !== "section") throw validation("kind");
    const itemId = body.integer("id");
    const position = body.integer("position");
    const baseSeq = body.integer("base_seq");
    let pinRef: { id: number; title: string } | null = null;
    let sectionRef: { id: number; name: string } | null = null;
    if (kind === "section") {
      const [moving] = order.sections.splice(order.sections.findIndex((section) => section.id === itemId), 1);
      if (!moving) throw notFound();
      if (position < 1 || position > order.sections.length + 1) throw validation("position");
      order.sections.splice(position - 1, 0, moving);
      sectionRef = { id: moving.id, name: moving.name };
    } else {
      removeFromOrder(order, new Set([itemId]));
      const target = containerOf(order, body.integerOrNull("section"));
      if (!target || position < 1 || position > target.length + 1) throw validation("position");
      target.splice(position - 1, 0, itemId);
      pinRef = await exactlyOne<{ id: number; title: string }>(client, "SELECT id, title FROM pins WHERE id = $1", [itemId]);
    }
    await writeOrder(client, boardId, order);
    const seq = await recordChange(client, boardId, actor, kind === "section" ? "section_moved" : "moved", pinRef, sectionRef);
    return { seq, rebased: baseSeq < access.seq, order: await loadOrder(client, boardId) };
  });
}

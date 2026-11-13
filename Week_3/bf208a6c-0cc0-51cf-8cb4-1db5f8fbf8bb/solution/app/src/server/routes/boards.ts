import { UNLOCK_COOKIE, authorize, callerOf, open, resolveAccess, linkApplies, type BoardRow, type Lookup } from "../access";
import { csvText } from "../csv";
import { one, pool, rows, transaction } from "../db";
import { kickRemoval } from "../background";
import { serveStream, writeBoard } from "../events";
import { empty, invalid, json, notFound, param, parseJson, setCookie, signInRequired, text, type Reply, type Request } from "../http";
import { hashSecret, newToken, secretMatches } from "../security";
import { boardOf, listingOf } from "../views";
import { may } from "../../shared/permissions";
import { MESSAGES, boardFieldErrors, boardPasswordError, boardTitleError } from "../../shared/rules";
import { GROUPS, LAYOUTS, LINK_ACCESSES, PRIVACIES, SORTS, isOneOf, type BoardSummary, type FieldErrors } from "../../shared/types";

export async function list(request: Request): Promise<Reply> {
  const { user } = await callerOf(request);
  if (!user) throw signInRequired();
  const boards = await rows<BoardSummary>(
    pool,
    `SELECT b.id, b.title, m.role,
            (SELECT count(*) FROM posts p WHERE p.board_id = b.id AND p.state = 'published') AS count,
            (SELECT count(*) FROM posts p WHERE p.board_id = b.id AND p.state = 'awaiting_approval') AS held
     FROM members m JOIN boards b ON b.id = m.board_id WHERE m.user_id = $1 ORDER BY b.created_at DESC, b.id`,
    [user.id],
  );
  return json(200, { boards: boards.map((board) => ({ ...board, held: may("moderate", board.role, null) ? board.held : 0 })) });
}

export async function create(request: Request): Promise<Reply> {
  const { user } = await callerOf(request);
  if (!user) throw signInRequired();
  const body = parseJson(request.body);
  const title = text(body["title"]).trim();
  const sections = Array.isArray(body["sections"]) ? body["sections"].map((section) => text(section).trim()) : [];
  const errors = boardFieldErrors(title, sections);
  if (Object.keys(errors).length) throw invalid(errors);
  const boardId = await transaction(async (db) => {
    const board = await one<{ id: string }>(db, `INSERT INTO boards (owner_id, title, link_token) VALUES ($1, $2, $3) RETURNING id`, [user.id, title, newToken()]);
    await db.query(`INSERT INTO members (board_id, user_id, role) VALUES ($1, $2, 'owner')`, [board.id, user.id]);
    for (const [ordinal, section] of sections.entries()) await db.query(`INSERT INTO sections (board_id, title, ordinal) VALUES ($1, $2, $3)`, [board.id, section, ordinal]);
    return board.id;
  });
  const access = await open(request, { boardId });
  return json(201, await boardOf(pool, access.board, access.role));
}

export async function get(request: Request): Promise<Reply> {
  const access = await open(request, { boardId: param(request, "id") });
  return json(200, await boardOf(pool, access.board, access.role));
}

function chosen<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined) return undefined;
  if (isOneOf(allowed, value)) return value;
  throw invalid({ [field]: `${field} must be one of ${allowed.join(", ")}.` });
}

export async function update(request: Request): Promise<Reply> {
  const access = await open(request, { boardId: param(request, "id") });
  authorize(access, "manage");
  const body = parseJson(request.body);
  const title = body["title"] === undefined ? undefined : text(body["title"]).trim();
  const errors: FieldErrors = {};
  const titleError = title === undefined ? null : boardTitleError(title);
  if (titleError) errors["title"] = titleError;
  const password = body["password"] === undefined ? undefined : text(body["password"]);
  const passwordError = password === undefined ? null : boardPasswordError(password);
  if (passwordError) errors["password"] = passwordError;
  const layout = chosen(body["layout"], LAYOUTS, "layout");
  const sort = chosen(body["sort"], SORTS, "sort");
  const grouping = chosen(body["group"], GROUPS, "group");
  const privacy = chosen(body["privacy"], PRIVACIES, "privacy");
  const linkAccess = chosen(body["link_access"], LINK_ACCESSES, "link_access");
  const approval = typeof body["approval"] === "boolean" ? body["approval"] : undefined;
  const passwordHash = password !== undefined && !passwordError ? await hashSecret(password) : undefined;
  const board = await writeBoard(access.board.id, async ({ db, emit, accessChanged }) => {
    const before = await one<BoardRow>(db, `SELECT * FROM boards WHERE id = $1`, [access.board.id]);
    const next = { ...before, privacy: privacy ?? before.privacy, link_access: linkAccess ?? before.link_access };
    if (next.privacy === "password" && !passwordHash && !before.password_hash) errors["password"] = MESSAGES.boardPassword;
    if (Object.keys(errors).length) throw invalid(errors);
    const linkEnds = linkApplies(before) && !linkApplies(next);
    const after = await one<BoardRow>(
      db,
      `UPDATE boards SET title = coalesce($2, title), layout = coalesce($3, layout), sort = coalesce($4, sort), grouping = coalesce($5, grouping),
         privacy = $6, link_access = $7, approval = coalesce($8, approval), password_hash = coalesce($9, password_hash),
         password_generation = password_generation + $10, link_token = CASE WHEN $11 THEN $12 ELSE link_token END WHERE id = $1 RETURNING *`,
      [before.id, title, layout, sort, grouping, next.privacy, next.link_access, approval, passwordHash, passwordHash ? 1 : 0, linkEnds, newToken()],
    );
    accessChanged();
    await emit({ type: "board_updated" });
    return boardOf(db, after, access.role);
  });
  return json(200, board);
}

export async function rotateLink(request: Request): Promise<Reply> {
  const access = await open(request, { boardId: param(request, "id") });
  authorize(access, "manage");
  const board = await writeBoard(access.board.id, async ({ db, emit, accessChanged }) => {
    const row = await one<BoardRow>(db, `UPDATE boards SET link_token = $2 WHERE id = $1 RETURNING *`, [access.board.id, newToken()]);
    accessChanged();
    await emit({ type: "board_updated" });
    return boardOf(db, row, access.role);
  });
  return json(200, { share_path: board.share_path, embed_path: board.embed_path });
}

export async function remove(request: Request): Promise<Reply> {
  const access = await open(request, { boardId: param(request, "id") });
  authorize(access, "manage");
  await writeBoard(access.board.id, async ({ db, accessChanged }) => {
    await db.query(`INSERT INTO storage_removals (prefix) VALUES ($1) ON CONFLICT DO NOTHING`, [`boards/${access.board.id}/`]);
    await db.query(`DELETE FROM boards WHERE id = $1`, [access.board.id]);
    accessChanged();
  });
  kickRemoval();
  return empty(204);
}

/** Adds an unlock for the board to the browser-session cookie when the password is right; every other case is a 404. */
export async function unlock(request: Request, lookup: Lookup): Promise<Reply> {
  const caller = await callerOf(request);
  const access = await resolveAccess(caller, lookup);
  if (access.kind === "not_found") throw notFound();
  const { board } = access;
  const password = text(parseJson(request.body)["password"]);
  if (board.privacy !== "password" || !board.password_hash || !(await secretMatches(password, board.password_hash))) throw notFound();
  const token = newToken();
  await pool.query(`INSERT INTO unlocks (token, board_id, generation) VALUES ($1, $2, $3)`, [token, board.id, board.password_generation]);
  setCookie(request.res, UNLOCK_COOKIE, [...caller.unlocks, token].slice(-20).join(","));
  return empty(204);
}

export const unlockBoard = (request: Request): Promise<Reply> => unlock(request, { boardId: param(request, "id") });

export async function posts(request: Request): Promise<Reply> {
  const access = await open(request, { boardId: param(request, "id") });
  return json(200, await listingOf(pool, access.board, access.role, access.caller.user?.id ?? null));
}

export async function events(request: Request): Promise<Reply> {
  await serveStream(request, { boardId: param(request, "id") });
  return null;
}

const fileName = (title: string): string => `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "board"}.csv`;

const stamp = (value: string): string => value.replace(/\.\d{3}Z$/, "Z");

export async function exportCsv(request: Request): Promise<Reply> {
  const access = await open(request, { boardId: param(request, "id") });
  authorize(access, "moderate");
  const listing = await listingOf(pool, access.board, access.role, access.caller.user?.id ?? null);
  const lines = listing.sections.flatMap((section) =>
    section.posts.map((post, index) => [
      post.id,
      section.title,
      String(index + 1),
      post.title,
      post.body,
      post.author.display_name,
      String(post.likes),
      String(post.score),
      String(post.comments),
      post.attachment?.file_name ?? "",
      stamp(post.created_at),
    ]),
  );
  const header = ["post_id", "section", "position", "title", "body", "author", "likes", "score", "comments", "attachment", "created_at"];
  return {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName(access.board.title)}"` },
    raw: Buffer.from(csvText([header, ...lines]), "utf8"),
  };
}

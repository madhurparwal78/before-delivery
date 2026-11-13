import { maybeOne, pool } from "./db";
import { forbidden, isUuid, notFound, passwordRequired, signInRequired, type Request } from "./http";
import { digest } from "./security";
import { may, type Capability } from "../shared/permissions";
import type { Account, Group, Layout, LinkAccess, Privacy, Role, Sort } from "../shared/types";

export const SESSION_COOKIE = "pinsheet_session";
export const UNLOCK_COOKIE = "pinsheet_pass";

export interface UserRow extends Account {
  verified: boolean;
}

export interface BoardRow {
  id: string;
  owner_id: string;
  title: string;
  layout: Layout;
  sort: Sort;
  grouping: Group;
  privacy: Privacy;
  password_hash: string | null;
  password_generation: number;
  approval: boolean;
  link_access: LinkAccess;
  link_token: string;
}

export interface Caller {
  user: UserRow | null;
  unlocks: string[];
}

export async function callerOf(request: Pick<Request, "cookies">): Promise<Caller> {
  const token = request.cookies[SESSION_COOKIE];
  const user = token
    ? await maybeOne<UserRow>(
        pool,
        `SELECT u.id, u.display_name, u.email, u.verified FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
        [digest(token)],
      )
    : null;
  return { user, unlocks: (request.cookies[UNLOCK_COOKIE] ?? "").split(",").filter(Boolean) };
}

export type Lookup = { boardId: string } | { linkToken: string };

type Access =
  | { kind: "ok"; board: BoardRow; role: Role | null }
  | { kind: "not_found" }
  | { kind: "password_required"; board: BoardRow };

/** Whether the board's share link works at all: private boards have no link, and link access must be on. */
export const linkApplies = (board: Pick<BoardRow, "privacy" | "link_access">): boolean => board.privacy !== "private" && board.link_access !== "off";

/** The embed of a board works only when the board is public. */
export const embedApplies = (board: Pick<BoardRow, "privacy" | "link_access">): boolean => board.privacy === "public" && board.link_access !== "off";

const BOARD_COLUMNS = `id, owner_id, title, layout, sort, grouping, privacy, password_hash, password_generation, approval, link_access, link_token`;

/** The one place that decides what a caller may open: error-order rules 2 and 3. */
export async function resolveAccess(caller: Caller, lookup: Lookup): Promise<Access> {
  if ("boardId" in lookup && !isUuid(lookup.boardId)) return { kind: "not_found" };
  const board =
    "boardId" in lookup
      ? await maybeOne<BoardRow>(pool, `SELECT ${BOARD_COLUMNS} FROM boards WHERE id = $1`, [lookup.boardId])
      : await maybeOne<BoardRow>(pool, `SELECT ${BOARD_COLUMNS} FROM boards WHERE link_token = $1`, [lookup.linkToken]);
  if (!board) return { kind: "not_found" };
  if ("linkToken" in lookup && !linkApplies(board)) return { kind: "not_found" };
  const member = caller.user
    ? await maybeOne<{ role: Role }>(pool, `SELECT role FROM members WHERE board_id = $1 AND user_id = $2`, [board.id, caller.user.id])
    : null;
  if (member) return { kind: "ok", board, role: member.role };
  if (board.privacy === "private") return { kind: "not_found" };
  if (board.privacy === "password") {
    const unlocked = caller.unlocks.length
      ? await maybeOne(pool, `SELECT 1 FROM unlocks WHERE board_id = $1 AND generation = $2 AND token = ANY($3)`, [
          board.id,
          board.password_generation,
          caller.unlocks,
        ])
      : null;
    if (!unlocked) return { kind: "password_required", board };
  }
  return { kind: "ok", board, role: null };
}

export interface Open {
  board: BoardRow;
  role: Role | null;
  caller: Caller;
}

export async function open(request: Request, lookup: Lookup): Promise<Open> {
  const caller = await callerOf(request);
  const access = await resolveAccess(caller, lookup);
  if (access.kind === "not_found") throw notFound();
  if (access.kind === "password_required") throw passwordRequired();
  return { board: access.board, role: access.role, caller };
}

interface PostOwnership {
  author_id: string;
}

/** Error-order rules 4 and 5: a signed-out caller gets 401, a signed-in caller without the capability gets 403. */
export function authorize(access: Open, capability: Exclude<Capability, "editPost" | "changePost">): UserRow;
export function authorize(access: Open, capability: "editPost" | "changePost", post: PostOwnership): UserRow;
export function authorize(access: Open, capability: Capability, post?: PostOwnership): UserRow {
  const user = access.caller.user;
  if (!user) throw signInRequired();
  if (!may(capability, access.role, user.id, post?.author_id)) throw forbidden();
  return user;
}

interface PostAccessRow {
  id: string;
  board_id: string;
  author_id: string;
  state: "published" | "awaiting_approval";
}

/** A held post is private to its author and to the people who moderate the board (error-order rule 2). */
export function postVisible(access: Open, post: PostAccessRow): boolean {
  return post.state === "published" || may("moderate", access.role, null) || post.author_id === access.caller.user?.id;
}

/** Opens the board of a post and checks the caller may see the post itself. */
export async function openPost(request: Request, postId: string): Promise<{ access: Open; post: PostAccessRow }> {
  const post = isUuid(postId)
    ? await maybeOne<PostAccessRow>(pool, `SELECT id, board_id, author_id, state FROM posts WHERE id = $1`, [postId])
    : null;
  if (!post) throw notFound();
  const access = await open(request, { boardId: post.board_id });
  if (!postVisible(access, post)) throw notFound();
  return { access, post };
}


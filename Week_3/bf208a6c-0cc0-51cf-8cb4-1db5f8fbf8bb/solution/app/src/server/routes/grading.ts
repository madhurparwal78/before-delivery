import type { PoolClient } from "pg";
import { embedApplies, linkApplies } from "../access";
import { config } from "../config";
import { one, transaction } from "../db";
import { ApiError, json, notFound, parseJson, type Reply, type Request } from "../http";
import { nextPosition } from "../postStore";
import { digest, hashSecret, newToken } from "../security";
import { MESSAGES } from "../../shared/rules";
import { GROUPS, INVITABLE_ROLES, LAYOUTS, LINK_ACCESSES, POST_STATES, PRIVACIES, SORTS, isOneOf, type Group, type InvitableRole, type Layout, type LinkAccess, type PostState, type Privacy, type Sort } from "../../shared/types";

const ENUMS = { layout: LAYOUTS, sort: SORTS, group: GROUPS, privacy: PRIVACIES, link_access: LINK_ACCESSES, state: POST_STATES, role: INVITABLE_ROLES } as const;

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {});
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

class Fixture {
  readonly errors: Record<string, string> = {};
  readonly users = new Map<string, { id: string; session: string }>();

  fail(path: string, message: string): void {
    this.errors[path] = message;
  }

  choice<T extends string>(path: string, value: unknown, allowed: readonly T[], fallback: T): T {
    if (value === undefined || value === null) return fallback;
    if (isOneOf(allowed, value)) return value;
    this.fail(path, `Must be one of ${allowed.join(", ")}.`);
    return fallback;
  }

  user(path: string, key: unknown): string {
    const found = typeof key === "string" ? this.users.get(key) : undefined;
    if (!found) {
      this.fail(path, `Unknown user ${String(key)}.`);
      return "";
    }
    return found.id;
  }
}

async function createUsers(db: PoolClient, fixture: Fixture, specs: unknown[]): Promise<void> {
  for (const [index, raw] of specs.entries()) {
    const spec = asObject(raw);
    const key = str(spec["key"]);
    if (!key) fixture.fail(`users.${index}.key`, "A key is required.");
    if ((await db.query(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [str(spec["email"])])).rowCount) {
      fixture.fail(`users.${index}.email`, MESSAGES.emailTaken);
      continue;
    }
    const session = newToken();
    const { id } = await one<{ id: string }>(
      db,
      `INSERT INTO users (display_name, email, password_hash, verified) VALUES ($1, $2, $3, $4) RETURNING id`,
      [str(spec["display_name"]), str(spec["email"]), await hashSecret(str(spec["password"])), spec["verified"] !== false],
    );
    await db.query(`INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)`, [digest(session), id]);
    fixture.users.set(key, { id, session });
  }
}

interface MadeBoard {
  id: string;
  path: string;
  share_path: string | null;
  embed_path: string | null;
  sections: Record<string, string>;
  posts: Record<string, string>;
}

async function createPosts(db: PoolClient, fixture: Fixture, at: string, boardId: string, sections: Record<string, string>, specs: unknown[], clock: { next: () => Date }): Promise<Record<string, string>> {
  const posts: Record<string, string> = {};
  for (const [position, rawPost] of specs.entries()) {
    const post = asObject(rawPost);
    const path = `${at}.posts.${position}`;
    const sectionId = sections[str(post["section"])];
    if (!sectionId) fixture.fail(`${path}.section`, `Unknown section ${str(post["section"])}.`);
    const author = fixture.user(`${path}.author`, post["author"]);
    const state: PostState = fixture.choice(`${path}.state`, post["state"], ENUMS.state, "published");
    if (!sectionId || !author) continue;
    const { id: postId } = await one<{ id: string }>(
      db,
      `INSERT INTO posts (board_id, section_id, author_id, title, body, state, position, last_actor_id, push, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $3, $8, $9) RETURNING id`,
      [boardId, sectionId, author, str(post["title"]), str(post["body"]), state, state === "published" ? await nextPosition(db, sectionId) : null, state === "published" ? null : "sent", clock.next()],
    );
    posts[str(post["key"])] = postId;
    for (const liker of asList(post["likes"])) {
      const userId = fixture.user(`${path}.likes`, liker);
      if (userId) await db.query(`INSERT INTO likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [postId, userId]);
    }
    for (const [voter, value] of Object.entries(asObject(post["votes"]))) {
      const userId = fixture.user(`${path}.votes.${voter}`, voter);
      if (value !== 1 && value !== -1) fixture.fail(`${path}.votes.${voter}`, "A vote is 1 or -1.");
      else if (userId) await db.query(`INSERT INTO votes (post_id, user_id, value) VALUES ($1, $2, $3)`, [postId, userId, value]);
    }
    for (const [number, rawComment] of asList(post["comments"]).entries()) {
      const comment = asObject(rawComment);
      const userId = fixture.user(`${path}.comments.${number}.author`, comment["author"]);
      if (userId) await db.query(`INSERT INTO comments (post_id, author_id, text) VALUES ($1, $2, $3)`, [postId, userId, str(comment["text"])]);
    }
  }
  return posts;
}

async function createBoard(db: PoolClient, fixture: Fixture, index: number, raw: unknown, clock: { next: () => Date }): Promise<{ key: string; made: MadeBoard } | null> {
  const spec = asObject(raw);
  const at = `boards.${index}`;
  const owner = fixture.user(`${at}.owner`, spec["owner"]);
  const layout: Layout = fixture.choice(`${at}.layout`, spec["layout"], ENUMS.layout, "columns");
  const sort: Sort = fixture.choice(`${at}.sort`, spec["sort"], ENUMS.sort, "by_hand");
  const grouping: Group = fixture.choice(`${at}.group`, spec["group"], ENUMS.group, "section");
  const privacy: Privacy = fixture.choice(`${at}.privacy`, spec["privacy"], ENUMS.privacy, "private");
  const linkAccess: LinkAccess = fixture.choice(`${at}.link_access`, spec["link_access"], ENUMS.link_access, "off");
  const sectionTitles = asList(spec["sections"]).map((title) => str(title));
  if (sectionTitles.length === 0) fixture.fail(`${at}.sections`, "At least one section is required.");
  if (!owner || sectionTitles.length === 0) return null;
  const password = typeof spec["password"] === "string" ? await hashSecret(spec["password"]) : null;
  const token = newToken();
  const { id: boardId } = await one<{ id: string }>(
    db,
    `INSERT INTO boards (owner_id, title, layout, sort, grouping, privacy, password_hash, approval, link_access, link_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [owner, str(spec["title"]), layout, sort, grouping, privacy, password, spec["approval"] === true, linkAccess, token],
  );
  await db.query(`INSERT INTO members (board_id, user_id, role) VALUES ($1, $2, 'owner')`, [boardId, owner]);
  const sections: Record<string, string> = {};
  for (const [ordinal, title] of sectionTitles.entries()) {
    sections[title] = (await one<{ id: string }>(db, `INSERT INTO sections (board_id, title, ordinal) VALUES ($1, $2, $3) RETURNING id`, [boardId, title, ordinal])).id;
  }
  for (const [userKey, role] of Object.entries(asObject(spec["members"]))) {
    const userId = fixture.user(`${at}.members.${userKey}`, userKey);
    const memberRole: InvitableRole = fixture.choice(`${at}.members.${userKey}`, role, ENUMS.role, "viewer");
    if (userId) await db.query(`INSERT INTO members (board_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [boardId, userId, memberRole]);
  }
  const posts = await createPosts(db, fixture, at, boardId, sections, asList(spec["posts"]), clock);
  const links = { privacy, link_access: linkAccess };
  return {
    key: str(spec["key"]),
    made: {
      id: boardId,
      path: `/b/${boardId}`,
      share_path: linkApplies(links) ? `/s/${token}` : null,
      embed_path: embedApplies(links) ? `/embed/${token}` : null,
      sections,
      posts,
    },
  };
}

/** Writes the requested users, boards and posts straight into the tables; sends no mail and no push. */
export async function create(request: Request): Promise<Reply> {
  if (!config.gradingKey || request.req.headers["x-grading-key"] !== config.gradingKey) throw notFound();
  const body = parseJson(request.body);
  const userSpecs = asList(body["users"]);
  const fixture = new Fixture();
  if (userSpecs.length === 0) fixture.fail("users", "At least one user is required.");
  const boards: Record<string, MadeBoard> = {};
  let epoch = Date.now();
  const clock = { next: () => new Date(epoch++) };
  await transaction(async (db) => {
    await createUsers(db, fixture, userSpecs);
    for (const [index, raw] of asList(body["boards"]).entries()) {
      const made = await createBoard(db, fixture, index, raw, clock);
      if (made) boards[made.key] = made.made;
    }
    if (Object.keys(fixture.errors).length) throw new ApiError(422, { errors: fixture.errors });
  });
  return json(201, { users: Object.fromEntries(fixture.users), boards });
}

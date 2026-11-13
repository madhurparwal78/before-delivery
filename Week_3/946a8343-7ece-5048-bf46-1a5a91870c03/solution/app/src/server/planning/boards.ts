// Boards: lists of cards over the issues of a project or a group, moves between lists, and the order of cards.
import type { Queryable, Say, Tx } from "../db.ts";
import { db, withTx } from "../db.ts";
import {
  can, findGroup, findProject, groupScope, projectAccess, projectScope, requireAction,
  type Access, type GroupRow, type ProjectRow,
} from "../access.ts";
import { now } from "../clock.ts";
import { conflict, FieldErrors, notFound } from "../errors.ts";
import { intParam, json, type Ctx, type Router } from "../http.ts";
import {
  byPosition, listsOf, place, planMove, POSITION_STEP,
  type BoardKind, type CardFacts, type ListDef, type RankedCard,
} from "./board-order.ts";
import { copyState } from "./issue-state.ts";
import { changeAssignees, changeLabels, setIssueState, setMilestone } from "./issue-state.ts";
import { findIssueById, loadState, Resolver, saveIssue } from "./issues-core.ts";
import { labelsOfGroup, labelsOfProject } from "./labels.ts";
import { mayRead, viewerOf, type Viewer } from "./visibility.ts";
import { bodyOf, groupPathOfProject, has, stringList } from "./util.ts";

interface BoardRow {
  readonly id: number;
  readonly project_id: number | null;
  readonly group_id: number | null;
  readonly name: string;
  readonly kind: BoardKind;
}

interface ListRow {
  readonly id: number;
  readonly kind: "open" | "list" | "closed";
  readonly title: string;
  readonly ref: string | null;
}

interface Board extends BoardRow {
  readonly lists: readonly ListDef[];
}

async function loadBoard(q: Queryable, id: number): Promise<Board | undefined> {
  const board = await q.maybe<BoardRow>("SELECT id, project_id, group_id, name, kind FROM boards WHERE id = $1", [id]);
  if (board === undefined) return undefined;
  const lists = await q.q<ListRow>("SELECT id, kind, title, ref FROM board_lists WHERE board_id = $1 ORDER BY position, id", [id]);
  return { ...board, lists };
}

interface NewBoard {
  readonly projectId: number | null;
  readonly groupId: number | null;
  readonly name: string;
  readonly kind: BoardKind;
  readonly titles: readonly string[];
}

/** Inserts a board with its `Open` and `Closed` lists first, then the given lists; returns the list ids by title. */
export async function insertBoard(tx: Tx, input: NewBoard): Promise<{ id: number; lists: Record<string, number> }> {
  const board = await tx.one<{ id: number }>(
    "INSERT INTO boards (project_id, group_id, name, kind, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [input.projectId, input.groupId, input.name, input.kind, now()],
  );
  const lists: Record<string, number> = {};
  const add = async (kind: ListRow["kind"], title: string, ref: string | null, position: number): Promise<void> => {
    const row = await tx.one<{ id: number }>(
      "INSERT INTO board_lists (board_id, kind, title, ref, position) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [board.id, kind, title, ref, position],
    );
    lists[title] = row.id;
  };
  await add("open", "Open", null, 0);
  await add("closed", "Closed", null, input.titles.length + 1);
  for (const [index, title] of input.titles.entries()) await add("list", title, title, index + 1);
  return { id: board.id, lists };
}

interface CardRow {
  readonly id: number;
  readonly iid: number;
  readonly title: string;
  readonly state: "opened" | "closed";
  readonly weight: number | null;
  readonly labels: string[];
  readonly position: number;
  readonly card_version: number;
  readonly confidential: boolean;
  readonly author_id: number;
  readonly project_id: number;
  readonly project_slug: string;
  readonly project_path: string;
  readonly milestone: string | null;
  readonly assignees: string[];
}

async function cardRows(q: Queryable, projectIds: readonly number[]): Promise<CardRow[]> {
  return q.q<CardRow>(
    `SELECT i.id, i.iid, i.title, i.state, i.weight, i.labels, i.position, i.card_version, i.confidential, i.author_id, i.project_id,
            p.slug AS project_slug, p.path AS project_path, m.title AS milestone,
            COALESCE((SELECT array_agg(au.username ORDER BY au.username) FROM issue_assignees ia JOIN users au ON au.id = ia.user_id WHERE ia.issue_id = i.id), '{}') AS assignees
       FROM issues i JOIN projects p ON p.id = i.project_id LEFT JOIN milestones m ON m.id = i.milestone_id
      WHERE i.project_id = ANY($1) ORDER BY i.position, i.id`,
    [projectIds],
  );
}

function factsOf(card: CardRow): CardFacts {
  return { state: card.state, labels: card.labels, assignees: card.assignees, milestone: card.milestone };
}

interface BoardScope {
  readonly board: Board;
  readonly project: ProjectRow | null;
  readonly group: GroupRow | null;
}

async function projectsUnder(q: Queryable, group: GroupRow): Promise<ProjectRow[]> {
  return q.q<ProjectRow>("SELECT * FROM projects WHERE path LIKE $1 ORDER BY path", [`${group.path}/%`]);
}

async function scopeOf(q: Queryable, board: Board): Promise<BoardScope> {
  const project = board.project_id === null ? null : ((await findProject(q, board.project_id)) ?? null);
  const group = board.group_id === null ? null : ((await findGroup(q, board.group_id)) ?? null);
  return { board, project, group };
}

/** The board of the request, with the projects whose issues it shows and how the viewer may read each of them. */
async function readableBoard(q: Queryable, ctx: Ctx, boardId: number): Promise<{ scope: BoardScope; access: Access; viewers: Map<number, Viewer> }> {
  const board = await loadBoard(q, boardId);
  if (board === undefined) throw notFound();
  const scope = await scopeOf(q, board);
  const viewers = new Map<number, Viewer>();
  if (scope.project !== null) {
    const { access } = await projectScope(q, ctx.user, scope.project.id);
    requireAction(access, "board.read");
    viewers.set(scope.project.id, viewerOf(ctx.user.id, access));
    return { scope, access, viewers };
  }
  if (scope.group === null) throw notFound();
  const { access } = await groupScope(q, ctx.user, scope.group.id);
  requireAction(access, "board.read");
  for (const project of await projectsUnder(q, scope.group)) {
    const projectRights = await projectAccess(q, ctx.user.id, project);
    if (can(projectRights, "issue.read")) viewers.set(project.id, viewerOf(ctx.user.id, projectRights));
  }
  return { scope, access, viewers };
}

async function visibleCards(q: Queryable, rows: readonly CardRow[], viewers: ReadonlyMap<number, Viewer>): Promise<CardRow[]> {
  const shown: CardRow[] = [];
  for (const card of rows) {
    const viewer = viewers.get(card.project_id);
    if (viewer !== undefined && (await mayRead(q, viewer, card))) shown.push(card);
  }
  return shown;
}

function cardView(card: CardRow, group: boolean): Record<string, unknown> {
  return {
    issue: card.id,
    iid: card.iid,
    title: card.title,
    weight: card.weight,
    labels: card.labels,
    version: card.card_version,
    position: card.position,
    state: card.state,
    assignees: card.assignees,
    milestone: card.milestone,
    confidential: card.confidential,
    project: group ? card.project_slug : null,
    project_id: card.project_id,
    project_path: card.project_path,
  };
}

function matchesFilters(card: CardRow, query: URLSearchParams): boolean {
  const label = query.get("label");
  if (label !== null && label !== "" && !card.labels.includes(label)) return false;
  const assignee = query.get("assignee");
  if (assignee !== null && assignee !== "" && !card.assignees.includes(assignee)) return false;
  const milestone = query.get("milestone");
  if (milestone !== null && milestone !== "" && card.milestone !== milestone) return false;
  const search = query.get("search");
  if (search !== null && search !== "" && !card.title.toLowerCase().includes(search.toLowerCase())) return false;
  return true;
}

function orderedLists(board: Board, cards: readonly CardRow[]): { list: ListDef; cards: CardRow[] }[] {
  return board.lists.map((list) => ({
    list,
    cards: byPosition(cards.filter((card) => listsOf(board.kind, board.lists, factsOf(card)).includes(list.id))),
  }));
}

const movedMessage = (user: string, list: string): string => `${user} moved this card first. It is now in ${list}.`;

interface MoveRequest {
  readonly issue: number;
  readonly toList: number;
  readonly fromList: number | null;
  readonly afterId: number | null;
  readonly version: number;
}

function readMove(ctx: Ctx, board: Board): { move: MoveRequest | null; errors: FieldErrors; target: ListDef | undefined } {
  const body = bodyOf(ctx);
  const errors = new FieldErrors();
  const integer = (key: string, nullable: boolean): number | null => {
    const value = body[key];
    if (nullable && (value === null || value === undefined)) return null;
    if (typeof value === "number" && Number.isInteger(value)) return value;
    errors.add(key, `${key} must be a whole number.`);
    return null;
  };
  const issue = integer("issue", false);
  const toList = integer("to_list", false);
  const afterId = integer("after_id", true);
  const version = integer("version", false);
  const fromList = integer("from_list", true);
  const target = board.lists.find((list) => list.id === toList);
  if (toList !== null && target === undefined) errors.add("to_list", "List doesn't exist on this board.");
  if (issue === null || toList === null || version === null) return { move: null, errors, target };
  return { move: { issue, toList, fromList, afterId, version }, errors, target };
}

/** Where cards stand after a move, in list order, for the people allowed to see them. */
async function listOrder(q: Queryable, board: Board, projectIds: readonly number[], viewers: ReadonlyMap<number, Viewer>): Promise<{ id: number; issue_ids: number[] }[]> {
  const cards = await visibleCards(q, await cardRows(q, projectIds), viewers);
  return orderedLists(board, cards).map(({ list, cards: inList }) => ({ id: list.id, issue_ids: inList.map((card) => card.id) }));
}

async function renumber(tx: Tx, projectIds: readonly number[]): Promise<void> {
  const rows = await cardRows(tx, projectIds);
  for (const [index, card] of rows.entries()) {
    await tx.q("UPDATE issues SET position = $2 WHERE id = $1", [card.id, (index + 1) * POSITION_STEP]);
  }
}

async function scopeProjectIds(q: Queryable, scope: BoardScope): Promise<number[]> {
  if (scope.project !== null) return [scope.project.id];
  return scope.group === null ? [] : (await projectsUnder(q, scope.group)).map((project) => project.id);
}

async function applyMove(tx: Tx, ctx: Ctx, boardId: number): Promise<Record<string, unknown>> {
  const board = await loadBoard(tx, boardId);
  if (board === undefined) throw notFound();
  const scope = await scopeOf(tx, board);
  if (scope.project !== null) {
    requireAction((await projectScope(tx, ctx.user, scope.project.id)).access, "board.read");
  } else if (scope.group !== null) {
    requireAction((await groupScope(tx, ctx.user, scope.group.id)).access, "board.read");
  } else {
    throw notFound();
  }
  const { move, errors, target } = readMove(ctx, board);
  const issueId = bodyOf(ctx)["issue"];
  const found = typeof issueId === "number" && Number.isInteger(issueId) ? await findIssueById(tx, issueId) : undefined;
  const project = found === undefined ? undefined : await findProject(tx, found.project_id);
  const projectIds = await scopeProjectIds(tx, scope);
  if (found === undefined || project === undefined || !projectIds.includes(project.id)) throw notFound();
  const access = await projectAccess(tx, ctx.user.id, project);
  const viewer = viewerOf(ctx.user.id, access);
  if (!can(access, "issue.read") || !(await mayRead(tx, viewer, found))) throw notFound();
  requireAction(access, "board.move");
  await tx.lockProject(project.id);
  const row = await findIssueById(tx, found.id, true);
  if (row === undefined) throw notFound();
  const cards = await cardRows(tx, projectIds);
  const current = cards.find((card) => card.id === row.id);
  if (current === undefined) throw notFound();
  if (move !== null && move.version !== row.card_version) {
    const mover = row.last_move_user_id === null ? undefined : await tx.maybe<{ username: string }>("SELECT username FROM users WHERE id = $1", [row.last_move_user_id]);
    const shownIn = board.lists.find((list) => list.id === listsOf(board.kind, board.lists, factsOf(current))[0]);
    throw conflict("stale_card", movedMessage(mover?.username ?? "Someone", shownIn?.title ?? "Open"));
  }
  if (move === null || target === undefined) {
    errors.throwIfAny();
    throw notFound();
  }
  const from = move.fromList === null ? undefined : board.lists.find((list) => list.id === move.fromList);
  if (move.fromList !== null && from === undefined) errors.add("from_list", "List doesn't exist on this board.");
  const before = await loadState(tx, row);
  const after = copyState(before);
  const plan = planMove(board.kind, board.lists, factsOf(current), target, from);
  const resolver = new Resolver(tx, project);
  const notes: string[] = [];
  if (plan.close) notes.push(...setIssueState(after, "closed"));
  if (plan.reopen) notes.push(...setIssueState(after, "opened"));
  if (board.kind === "label") {
    const add = plan.add?.ref ?? null;
    const remove = plan.remove?.ref ?? null;
    if (add !== null || remove !== null) notes.push(...changeLabels(after, add === null ? [] : [add], remove === null ? [] : [remove]));
  } else if (board.kind === "assignee") {
    const add = plan.add?.ref ?? null;
    const remove = plan.remove?.ref ?? null;
    notes.push(...changeAssignees(after, add === null ? [] : [add], remove === null ? [] : [remove]));
  } else {
    if (plan.remove !== null) setMilestone(after, null);
    if (plan.add?.ref != null) {
      const milestone = await resolver.milestoneByTitle(plan.add.ref);
      if (milestone === undefined) errors.add("to_list", `Milestone %${plan.add.ref} doesn't exist in this project.`);
      else notes.push(...setMilestone(after, milestone));
    }
  }
  errors.throwIfAny();
  const afterFacts: CardFacts = { state: after.state, labels: after.labels, assignees: after.assignees, milestone: after.milestone?.title ?? null };
  const targetCards = cards.filter((card) => card.id !== row.id && listsOf(board.kind, board.lists, factsOf(card)).includes(target.id));
  const sees = async (id: number): Promise<boolean> => {
    const other = cards.find((card) => card.id === id);
    const otherViewer = other === undefined ? undefined : viewerOf(ctx.user.id, await projectAccess(tx, ctx.user.id, (await findProject(tx, other.project_id)) ?? project));
    return other !== undefined && otherViewer !== undefined && (await mayRead(tx, otherViewer, other));
  };
  const rank = (list: readonly CardRow[]): RankedCard[] => byPosition(list).map((card) => ({ id: card.id, position: card.position }));
  const inTarget = listsOf(board.kind, board.lists, afterFacts).includes(target.id);
  const afterId = move.afterId !== null && !(await sees(move.afterId)) ? -1 : move.afterId;
  let placement = place(inTarget ? rank(targetCards) : [], afterId, row.position);
  if (placement.kind === "crowded") {
    await renumber(tx, projectIds);
    const fresh = (await cardRows(tx, projectIds)).filter((card) => card.id !== row.id && listsOf(board.kind, board.lists, factsOf(card)).includes(target.id));
    placement = place(rank(fresh), afterId, row.position);
  }
  if (placement.kind === "crowded") throw conflict("stale_card", movedMessage("Someone", target.title));
  const reply = [...notes];
  const privately: Say[] = [];
  if (placement.fellBack) {
    const text = `Card moved: ${before.title} went to the end of ${target.title}.`;
    reply.push(text);
    privately.push({ text, to: ctx.user.username, pages: [`board:${board.id}`] });
  }
  const saved = await saveIssue(tx, {
    project, row, before, after, actor: ctx.user.username, notes,
    move: { userId: ctx.user.id, position: placement.position }, privately,
  });
  const viewers = new Map<number, Viewer>();
  for (const id of projectIds) {
    const owner = id === project.id ? project : await findProject(tx, id);
    if (owner === undefined) continue;
    const rights = await projectAccess(tx, ctx.user.id, owner);
    if (can(rights, "issue.read")) viewers.set(id, viewerOf(ctx.user.id, rights));
  }
  const moved = (await cardRows(tx, projectIds)).find((card) => card.id === row.id);
  return {
    card: moved === undefined ? null : cardView(moved, board.group_id !== null),
    lists: await listOrder(tx, board, projectIds, viewers),
    notes: reply,
    seq: saved.seq ?? (await tx.currentSeq(project.id)),
  };
}

type Owner = { readonly project: ProjectRow } | { readonly group: GroupRow };

async function listTitles(fields: FieldErrors, ctx: Ctx, kind: BoardKind, owner: Owner, tx: Tx): Promise<string[]> {
  const body = bodyOf(ctx);
  const titles = stringList(body["lists"]);
  if (titles === null) {
    if (has(body, "lists")) fields.add("lists", "Lists must be a list of names.");
    return [];
  }
  if (new Set(titles).size !== titles.length) fields.add("lists", "Lists can't repeat a name.");
  const known = "project" in owner ? await labelsOfProject(tx, owner.project) : await labelsOfGroup(tx, owner.group.path);
  const resolver = "project" in owner ? new Resolver(tx, owner.project) : undefined;
  for (const title of titles) {
    if (title.trim() === "" || title === "Open" || title === "Closed") fields.add("lists", `List ${title === "" ? "name" : title} can't be used.`);
    else if (kind === "label" && !known.some((label) => label.name === title)) fields.add("lists", `Label ~${title} doesn't exist.`);
    else if (kind === "assignee" && (await tx.maybe("SELECT 1 FROM users WHERE username = $1", [title])) === undefined) fields.add("lists", `User @${title} doesn't exist.`);
    else if (kind === "milestone" && resolver !== undefined && (await resolver.milestoneByTitle(title)) === undefined) fields.add("lists", `Milestone %${title} doesn't exist.`);
  }
  return titles;
}

function boardInput(ctx: Ctx, errors: FieldErrors): { name: string; kind: BoardKind } {
  const body = bodyOf(ctx);
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  if (name === "") errors.add("name", "Name can't be blank.");
  const kind = body["kind"] === "label" || body["kind"] === "assignee" || body["kind"] === "milestone" ? body["kind"] : undefined;
  if (kind === undefined) errors.add("kind", "Kind must be label, assignee or milestone.");
  return { name, kind: kind ?? "label" };
}

export function registerBoardRoutes(router: Router): void {
  router.get("/api/projects/:id/boards", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "board.read");
    const boards = await db.q<BoardRow>("SELECT id, project_id, group_id, name, kind FROM boards WHERE project_id = $1 ORDER BY id", [project.id]);
    const inherited = await db.q<BoardRow>(
      `SELECT b.id, b.project_id, b.group_id, b.name, b.kind FROM boards b JOIN groups g ON g.id = b.group_id
        WHERE $1 = g.path OR $1 LIKE g.path || '/%' ORDER BY b.id`,
      [groupPathOfProject(project.path)],
    );
    return json(200, { boards: [...boards, ...inherited] });
  });

  router.get("/api/groups/:id/boards", async (ctx) => {
    const { group, access } = await groupScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "board.read");
    const boards = await db.q<BoardRow>("SELECT id, project_id, group_id, name, kind FROM boards WHERE group_id = $1 ORDER BY id", [group.id]);
    return json(200, { boards });
  });

  router.post("/api/projects/:id/boards", async (ctx) =>
    withTx(async (tx) => {
      const { project, access } = await projectScope(tx, ctx.user, intParam(ctx, "id"));
      requireAction(access, "board.admin");
      await tx.lockProject(project.id);
      const errors = new FieldErrors();
      const { name, kind } = boardInput(ctx, errors);
      const titles = await listTitles(errors, ctx, kind, { project }, tx);
      errors.throwIfAny();
      const created = await insertBoard(tx, { projectId: project.id, groupId: null, name, kind, titles });
      const seq = await tx.emit(project.id, "board", { board_ids: [created.id] });
      return json(201, { id: created.id, lists: created.lists, seq });
    }),
  );

  router.post("/api/groups/:id/boards", async (ctx) =>
    withTx(async (tx) => {
      const { group, access } = await groupScope(tx, ctx.user, intParam(ctx, "id"));
      requireAction(access, "board.admin");
      const errors = new FieldErrors();
      const { name, kind } = boardInput(ctx, errors);
      const titles = await listTitles(errors, ctx, kind, { group }, tx);
      errors.throwIfAny();
      const created = await insertBoard(tx, { projectId: null, groupId: group.id, name, kind, titles });
      return json(201, { id: created.id, lists: created.lists });
    }),
  );

  router.get("/api/boards/:id", async (ctx) => {
    const { scope, viewers } = await readableBoard(db, ctx, intParam(ctx, "id"));
    const projectIds = [...viewers.keys()];
    const shown = (await visibleCards(db, await cardRows(db, projectIds), viewers)).filter((card) => matchesFilters(card, ctx.query));
    const group = scope.board.group_id !== null;
    const lists = orderedLists(scope.board, shown).map(({ list, cards }) => ({
      id: list.id, title: list.title, kind: list.kind, count: cards.length, cards: cards.map((card) => cardView(card, group)),
    }));
    return json(200, {
      id: scope.board.id, name: scope.board.name, kind: scope.board.kind, project_id: scope.board.project_id, group_id: scope.board.group_id, lists,
    });
  });

  router.post("/api/boards/:id/moves", async (ctx) => withTx(async (tx) => json(200, await applyMove(tx, ctx, intParam(ctx, "id")))));
}

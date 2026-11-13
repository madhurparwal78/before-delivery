// Issue storage: loading, creating, saving a change in one write, and telling the live channel and the webhooks about it.
// Every route that changes an issue (create, PATCH, comment quick actions, board moves, closing by merge) ends here.
import type { Queryable, Say, Tx } from "../db.ts";
import type { ProjectRow } from "../access.ts";
import { iso, now } from "../clock.ts";
import { formatDuration } from "../lib/quick-actions.ts";
import { dispatchWebhook } from "../admin/index.ts";
import { labelsOfProject, type LabelInfo } from "./labels.ts";
import type { IssueState } from "./issue-state.ts";
import { mayRead, type Viewer } from "./visibility.ts";
import { groupPathOfProject, noteView, type NoteRow, type NoteView } from "./util.ts";

export interface IssueRow {
  readonly id: number;
  readonly project_id: number;
  readonly iid: number;
  readonly title: string;
  readonly description: string;
  readonly state: "opened" | "closed";
  readonly author_id: number;
  readonly confidential: boolean;
  readonly labels: string[];
  readonly milestone_id: number | null;
  readonly weight: number | null;
  readonly due_date: string | null;
  readonly estimate_minutes: number | null;
  readonly spent_minutes: number;
  readonly epic_id: number | null;
  readonly position: number;
  readonly card_version: number;
  readonly last_move_user_id: number | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly closed_at: number | null;
}

export interface Actor {
  readonly id: number;
  readonly username: string;
}

export async function findIssue(q: Queryable, projectId: number, iid: number, lock = false): Promise<IssueRow | undefined> {
  return q.maybe<IssueRow>(`SELECT * FROM issues WHERE project_id = $1 AND iid = $2${lock ? " FOR UPDATE" : ""}`, [projectId, iid]);
}

export async function findIssueById(q: Queryable, id: number, lock = false): Promise<IssueRow | undefined> {
  return q.maybe<IssueRow>(`SELECT * FROM issues WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
}

async function assigneesOf(q: Queryable, issueId: number): Promise<string[]> {
  const rows = await q.q<{ username: string }>(
    "SELECT u.username FROM issue_assignees a JOIN users u ON u.id = a.user_id WHERE a.issue_id = $1 ORDER BY u.username",
    [issueId],
  );
  return rows.map((row) => row.username);
}

export async function userIds(q: Queryable, usernames: readonly string[]): Promise<Map<string, number>> {
  const rows = await q.q<{ id: number; username: string }>("SELECT id, username FROM users WHERE username = ANY($1)", [usernames]);
  return new Map(rows.map((row) => [row.username, row.id]));
}

export async function loadState(q: Queryable, row: IssueRow): Promise<IssueState> {
  const milestone =
    row.milestone_id === null ? null : await q.maybe<{ id: number; title: string }>("SELECT id, title FROM milestones WHERE id = $1", [row.milestone_id]);
  return {
    title: row.title,
    description: row.description,
    state: row.state,
    labels: [...row.labels],
    assignees: await assigneesOf(q, row.id),
    milestone: milestone ?? null,
    weight: row.weight,
    dueDate: row.due_date,
    estimate: row.estimate_minutes,
    spent: row.spent_minutes,
    confidential: row.confidential,
    epicId: row.epic_id,
  };
}

/** Looks up what a change refers to by name, once per request. */
export class Resolver {
  readonly project: ProjectRow;
  private readonly q: Queryable;
  private known: LabelInfo[] | undefined;

  constructor(q: Queryable, project: ProjectRow) {
    this.q = q;
    this.project = project;
  }

  async labels(): Promise<LabelInfo[]> {
    this.known ??= await labelsOfProject(this.q, this.project);
    return this.known;
  }

  async hasLabel(name: string): Promise<boolean> {
    return (await this.labels()).some((label) => label.name === name);
  }

  async userExists(username: string): Promise<boolean> {
    return (await this.q.maybe("SELECT 1 FROM users WHERE username = $1", [username])) !== undefined;
  }

  async milestoneByTitle(title: string): Promise<{ id: number; title: string } | undefined> {
    return this.q.maybe<{ id: number; title: string }>("SELECT id, title FROM milestones WHERE project_id = $1 AND title = $2", [this.project.id, title]);
  }

  async milestoneById(id: number): Promise<{ id: number; title: string } | undefined> {
    return this.q.maybe<{ id: number; title: string }>("SELECT id, title FROM milestones WHERE project_id = $1 AND id = $2", [this.project.id, id]);
  }
}

const POSITION_GAP = 1024;

async function nextPosition(q: Queryable): Promise<number> {
  const row = await q.one<{ top: number }>("SELECT COALESCE(MAX(position), 0) + $1 AS top FROM issues", [POSITION_GAP]);
  return row.top;
}

interface NewIssue {
  readonly author: Actor;
  readonly state: IssueState;
}

/** Inserts an issue with the next iid of the project, its assignees and the first history event. No live message. */
export async function insertIssue(tx: Tx, project: ProjectRow, input: NewIssue): Promise<IssueRow> {
  const { iid } = await tx.one<{ iid: number }>("UPDATE projects SET next_issue_iid = next_issue_iid + 1 WHERE id = $1 RETURNING next_issue_iid - 1 AS iid", [project.id]);
  const s = input.state;
  const at = now();
  const row = await tx.one<IssueRow>(
    `INSERT INTO issues (project_id, iid, title, description, state, author_id, confidential, labels, milestone_id, weight, due_date,
        estimate_minutes, spent_minutes, epic_id, position, created_at, updated_at, closed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16, $17) RETURNING *`,
    [
      project.id, iid, s.title, s.description, s.state, input.author.id, s.confidential, s.labels, s.milestone?.id ?? null, s.weight, s.dueDate,
      s.estimate, s.spent, s.epicId, await nextPosition(tx), at, s.state === "closed" ? at : null,
    ],
  );
  await setAssignees(tx, row.id, s.assignees);
  await tx.q("INSERT INTO issue_history (issue_id, at, weight, state) VALUES ($1, $2, $3, $4)", [row.id, at, s.weight, s.state]);
  return row;
}

async function setAssignees(tx: Tx, issueId: number, usernames: readonly string[]): Promise<void> {
  const ids = await userIds(tx, usernames);
  const wanted = usernames.flatMap((name) => ids.get(name) ?? []);
  await tx.q("DELETE FROM issue_assignees WHERE issue_id = $1 AND NOT (user_id = ANY($2))", [issueId, wanted]);
  for (const userId of wanted) {
    await tx.q("INSERT INTO issue_assignees (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [issueId, userId]);
  }
}

async function writeNote(tx: Tx, issueId: number, author: string, body: string, system: boolean, at: number = now()): Promise<NoteView> {
  const row = await tx.one<NoteRow>(
    "INSERT INTO issue_notes (issue_id, author, body, system, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, author, body, system, created_at",
    [issueId, author, body, system, at],
  );
  return noteView(row);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

interface Change {
  readonly cardRelevant: boolean;
  readonly burndownRelevant: boolean;
  readonly any: boolean;
  readonly webhook: "update" | "close" | "reopen" | null;
}

export function diffStates(before: IssueState, after: IssueState): Change {
  const stateChanged = before.state !== after.state;
  const weightChanged = before.weight !== after.weight;
  const milestoneChanged = before.milestone?.id !== after.milestone?.id;
  const cardRelevant =
    before.title !== after.title || !sameSet(before.labels, after.labels) || !sameSet(before.assignees, after.assignees) ||
    milestoneChanged || weightChanged || stateChanged || before.confidential !== after.confidential;
  const fieldChanged =
    cardRelevant || before.description !== after.description || before.dueDate !== after.dueDate ||
    before.estimate !== after.estimate || before.spent !== after.spent || before.epicId !== after.epicId;
  const webhook = stateChanged ? (after.state === "closed" ? "close" : "reopen") : fieldChanged ? "update" : null;
  return { cardRelevant, burndownRelevant: stateChanged || weightChanged || milestoneChanged, any: fieldChanged, webhook };
}

interface Saved {
  readonly seq: number | null;
  readonly comment: NoteView | null;
}

interface SaveInput {
  readonly project: ProjectRow;
  readonly row: IssueRow;
  readonly before: IssueState;
  readonly after: IssueState;
  readonly actor: string;
  /** System notes in the order they are written and announced. */
  readonly notes: readonly string[];
  readonly comment?: string;
  /** A board move: the card's version goes up by one and the card takes `position`. */
  readonly move?: { readonly userId: number; readonly position: number };
  /** Announcements for one person only, sent with the issue message. */
  readonly privately?: readonly Say[];
}

/** Writes one change of an issue: the row, its assignees, the history event, the notes, the live messages and the webhook. */
export async function saveIssue(tx: Tx, input: SaveInput): Promise<Saved> {
  const { project, row, before, after } = input;
  const change = diffStates(before, after);
  const at = now();
  const closedAt = after.state === "closed" ? (before.state === "closed" ? row.closed_at : at) : null;
  const unchanged = !change.any && input.move === undefined;
  if (!unchanged) {
    await tx.q(
      `UPDATE issues SET title = $2, description = $3, state = $4, labels = $5, milestone_id = $6, weight = $7, due_date = $8,
              estimate_minutes = $9, spent_minutes = $10, confidential = $11, epic_id = $12, closed_at = $13, updated_at = $14,
              position = COALESCE($15, position), card_version = card_version + $16, last_move_user_id = COALESCE($17, last_move_user_id)
        WHERE id = $1`,
      [
        row.id, after.title, after.description, after.state, after.labels, after.milestone?.id ?? null, after.weight, after.dueDate,
        after.estimate, after.spent, after.confidential, after.epicId, closedAt, at,
        input.move?.position ?? null, input.move === undefined ? 0 : 1, input.move?.userId ?? null,
      ],
    );
    if (!sameSet(before.assignees, after.assignees)) await setAssignees(tx, row.id, after.assignees);
    if (before.weight !== after.weight || before.state !== after.state) {
      await tx.q("INSERT INTO issue_history (issue_id, at, weight, state) VALUES ($1, $2, $3, $4)", [row.id, at, after.weight, after.state]);
    }
  }
  const comment = input.comment === undefined ? null : await writeNote(tx, row.id, input.actor, input.comment, false, at);
  for (const body of input.notes) await writeNote(tx, row.id, input.actor, body, true, at);
  const seq = await announce(tx, {
    project, issue: { id: row.id, iid: row.iid, epicId: before.epicId }, before, after, change, notes: input.notes,
    commented: comment !== null, cardMoved: input.move !== undefined, privately: input.privately ?? [],
  });
  return { seq, comment };
}

interface Announcement {
  readonly project: ProjectRow;
  readonly issue: { readonly id: number; readonly iid: number; readonly epicId: number | null };
  readonly before: IssueState | null;
  readonly after: IssueState;
  readonly change: Change;
  readonly notes: readonly string[];
  readonly commented: boolean;
  readonly cardMoved: boolean;
  readonly privately?: readonly Say[];
}

async function boardIdsFor(q: Queryable, project: ProjectRow): Promise<number[]> {
  const rows = await q.q<{ id: number }>(
    `SELECT b.id FROM boards b LEFT JOIN groups g ON g.id = b.group_id
      WHERE b.project_id = $1 OR (b.group_id IS NOT NULL AND ($2 = g.path OR $2 LIKE g.path || '/%')) ORDER BY b.id`,
    [project.id, groupPathOfProject(project.path)],
  );
  return rows.map((row) => row.id);
}

/** Live messages (board, milestone, epic, then issue; the last one carries the announcements) and the issue webhook. */
export async function announce(tx: Tx, a: Announcement): Promise<number | null> {
  const created = a.before === null;
  const { change, after, issue } = a;
  if (!created && !change.any && a.notes.length === 0 && !a.commented && !a.cardMoved) return null;
  const restrict = after.confidential || a.before?.confidential === true ? { restrictIssue: issue.id } : {};
  let seq: number | null = null;
  if (created || change.cardRelevant || a.cardMoved) {
    const boards = await boardIdsFor(tx, a.project);
    if (boards.length > 0) seq = await tx.emit(a.project.id, "board", { issue_id: issue.id, board_ids: boards }, restrict);
  }
  const milestones = new Set<number>();
  if (created || change.burndownRelevant) {
    for (const milestone of [a.before?.milestone, after.milestone]) if (milestone) milestones.add(milestone.id);
  }
  for (const id of milestones) seq = await tx.emit(a.project.id, "milestone", { id }, restrict);
  const epics = new Set<number>();
  if (after.epicId !== null && (created || change.cardRelevant)) epics.add(after.epicId);
  if (a.before !== null && a.before.epicId !== null && a.before.epicId !== after.epicId) epics.add(a.before.epicId);
  for (const epicId of epics) {
    const epic = await tx.maybe<{ group_id: number; iid: number }>("SELECT group_id, iid FROM epics WHERE id = $1", [epicId]);
    if (epic !== undefined) seq = await tx.emit(a.project.id, "epic", { group_id: epic.group_id, iid: epic.iid }, restrict);
  }
  const say: Say[] = [...a.notes.map((text) => ({ text, pages: [`issue:${issue.iid}`] })), ...(a.privately ?? [])];
  seq = await tx.emit(a.project.id, "issue", { iid: issue.iid }, say.length > 0 ? { ...restrict, say } : restrict);
  const action = created ? "open" : change.webhook;
  if (action !== null && !after.confidential) {
    await dispatchWebhook(tx, a.project, "issue", {
      event: "issue",
      action,
      project: { id: a.project.id, path: a.project.path },
      issue: { iid: issue.iid, title: after.title, state: after.state },
    });
  }
  return seq;
}

/** Records a link of `source` to `target`; the target's page is told. False when the link already exists. */
export async function linkIssues(tx: Tx, project: ProjectRow, source: IssueRow, target: IssueRow, kind: LinkView["kind"]): Promise<boolean> {
  const created = await tx.maybe(
    "INSERT INTO issue_links (source_id, target_id, kind, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id",
    [source.id, target.id, kind, now()],
  );
  if (created === undefined) return false;
  await tx.emit(project.id, "issue", { iid: target.iid }, target.confidential ? { restrictIssue: target.id } : {});
  return true;
}

export interface LinkView {
  readonly kind: "relates" | "blocks" | "blocked by";
  readonly iid: number;
  readonly title: string;
  readonly state: "opened" | "closed";
}

async function linksOf(q: Queryable, viewer: Viewer, row: IssueRow): Promise<LinkView[]> {
  const rows = await q.q<{ kind: LinkView["kind"]; outgoing: boolean; id: number; iid: number; title: string; state: "opened" | "closed"; confidential: boolean; author_id: number }>(
    `SELECT l.kind, (l.source_id = $1) AS outgoing, i.id, i.iid, i.title, i.state, i.confidential, i.author_id
       FROM issue_links l JOIN issues i ON i.id = CASE WHEN l.source_id = $1 THEN l.target_id ELSE l.source_id END
      WHERE l.source_id = $1 OR l.target_id = $1 ORDER BY l.id`,
    [row.id],
  );
  const views: LinkView[] = [];
  for (const link of rows) {
    if (!(await mayRead(q, viewer, link))) continue;
    const kind = link.outgoing || link.kind === "relates" ? link.kind : link.kind === "blocks" ? "blocked by" : "blocks";
    views.push({ kind, iid: link.iid, title: link.title, state: link.state });
  }
  return views;
}

interface IssueView {
  readonly [key: string]: unknown;
}

export async function issueView(q: Queryable, project: ProjectRow, row: IssueRow, viewer: Viewer): Promise<IssueView> {
  const state = await loadState(q, row);
  const author = await q.one<{ username: string }>("SELECT username FROM users WHERE id = $1", [row.author_id]);
  const epic =
    row.epic_id === null ? null : await q.maybe<{ iid: number; title: string; group_id: number }>("SELECT iid, title, group_id FROM epics WHERE id = $1", [row.epic_id]);
  return {
    id: row.id,
    iid: row.iid,
    project_id: project.id,
    title: row.title,
    description: row.description,
    state: row.state,
    author: author.username,
    assignees: state.assignees,
    labels: row.labels,
    milestone: state.milestone?.title ?? null,
    milestone_id: row.milestone_id,
    weight: row.weight,
    due_date: row.due_date,
    estimate: row.estimate_minutes === null ? null : formatDuration(row.estimate_minutes),
    time_spent: row.spent_minutes > 0 ? formatDuration(row.spent_minutes) : null,
    confidential: row.confidential,
    epic: epic ?? null,
    links: await linksOf(q, viewer, row),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    closed_at: row.closed_at === null ? null : iso(row.closed_at),
  };
}

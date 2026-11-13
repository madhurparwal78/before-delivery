// Seeding for the grading route: planning data goes in directly, without roles, live messages, webhooks or audit.
import type { Tx } from "../db.ts";
import type { ProjectRow } from "../access.ts";
import { now } from "../clock.ts";
import { validationOne } from "../errors.ts";
import type {
  PlanningSeedResult, SeedBoard, SeedEpic, SeedIssue, SeedKeys, SeedLabel, SeedMilestone, SeedWikiPage,
} from "../admin/seed-spec.ts";
import { insertBoard } from "./boards.ts";
import { insertEpic } from "./epics.ts";
import { insertIssue, userIds } from "./issues-core.ts";

export async function seedGroupLabels(tx: Tx, groupId: number, labels: readonly { name: string; description: string }[]): Promise<void> {
  for (const label of labels) {
    await tx.q(
      "INSERT INTO labels (group_id, name, description, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (group_id, name) WHERE group_id IS NOT NULL DO UPDATE SET description = EXCLUDED.description",
      [groupId, label.name, label.description, now()],
    );
  }
}

async function personId(tx: Tx, keys: SeedKeys, username: string): Promise<number> {
  const known = keys.userIds.get(username) ?? (await userIds(tx, [username])).get(username);
  if (known === undefined) throw validationOne("users", `User ${username} doesn't exist.`);
  return known;
}

export async function seedProjectPlanning(
  tx: Tx,
  project: ProjectRow,
  keys: SeedKeys,
  spec: { labels: SeedLabel[]; milestones: SeedMilestone[]; issues: SeedIssue[]; boards: SeedBoard[]; wiki: SeedWikiPage[] },
): Promise<PlanningSeedResult> {
  const labels: Record<string, { id: number }> = {};
  for (const label of spec.labels) {
    const row = await tx.one<{ id: number }>(
      `INSERT INTO labels (project_id, name, description, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, name) WHERE project_id IS NOT NULL DO UPDATE SET description = EXCLUDED.description RETURNING id`,
      [project.id, label.name, label.description, now()],
    );
    labels[label.name] = { id: row.id };
  }
  const milestones: Record<string, { id: number }> = {};
  const milestoneByKey = new Map<string, { id: number; title: string }>();
  for (const milestone of spec.milestones) {
    const row = await tx.one<{ id: number }>(
      "INSERT INTO milestones (project_id, title, start_date, due_date, time_zone, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [project.id, milestone.title, milestone.start, milestone.due, milestone.time_zone, now()],
    );
    milestones[milestone.key] = { id: row.id };
    milestoneByKey.set(milestone.key, { id: row.id, title: milestone.title });
  }
  const issues: Record<string, { id: number; iid: number }> = {};
  for (const issue of spec.issues) {
    const milestone = issue.milestone === null ? null : (milestoneByKey.get(issue.milestone) ?? null);
    if (issue.milestone !== null && milestone === null) throw validationOne("milestone", `Milestone ${issue.milestone} doesn't exist.`);
    const row = await insertIssue(tx, project, {
      author: { id: await personId(tx, keys, issue.author), username: issue.author },
      state: {
        title: issue.title, description: issue.description, state: issue.state, labels: issue.labels, assignees: [...new Set(issue.assignees)],
        milestone, weight: issue.weight, dueDate: null, estimate: null, spent: 0, confidential: issue.confidential, epicId: null,
      },
    });
    issues[issue.key] = { id: row.id, iid: row.iid };
    keys.issueIds.set(issue.key, { id: row.id, iid: row.iid });
  }
  const boards: Record<string, { id: number; lists: Record<string, number> }> = {};
  for (const board of spec.boards) {
    boards[board.key] = await insertBoard(tx, { projectId: project.id, groupId: null, name: board.name, kind: board.kind, titles: board.lists });
  }
  const wiki: Record<string, { version: number }> = {};
  for (const page of spec.wiki) {
    await tx.q(
      "INSERT INTO wiki_versions (project_id, slug, version, title, content, author, created_at) VALUES ($1, $2, 1, $3, $4, $5, $6)",
      [project.id, page.slug, page.title, page.content, page.author, now()],
    );
    wiki[page.slug] = { version: 1 };
  }
  return { milestones, labels, issues, boards, wiki };
}

export async function seedEpics(
  tx: Tx,
  groupId: number,
  keys: SeedKeys,
  _projectKeys: ReadonlyMap<string, number>,
  epics: readonly SeedEpic[],
): Promise<Record<string, { id: number; iid: number }>> {
  const made: Record<string, { id: number; iid: number }> = {};
  for (const epic of epics) {
    const parent = epic.parent === null ? null : made[epic.parent];
    if (epic.parent !== null && parent === undefined) throw validationOne("epics", `Parent epic ${epic.parent} comes later in the list.`);
    const row = await insertEpic(tx, {
      groupId, title: epic.title, description: "", authorId: await personId(tx, keys, epic.author), confidential: false, parentId: parent?.id ?? null, labels: [],
    });
    made[epic.key] = { id: row.id, iid: row.iid };
    for (const reference of epic.issues) {
      const issue = keys.issueIds.get(reference);
      if (issue === undefined) throw validationOne("epics", `Issue ${reference} doesn't exist.`);
      await tx.q("UPDATE issues SET epic_id = $2 WHERE id = $1", [issue.id, row.id]);
    }
  }
  return made;
}

// Response shapes of the planning API (issues, notes, milestones, burndown, epics, boards) and the readers that narrow `unknown`
// JSON into them.
import { asNumber, asString, asStringList, isRecord } from "../../util.ts";

export type IssueState = "opened" | "closed";

function issueState(value: unknown): IssueState {
  return value === "closed" ? "closed" : "opened";
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface IssueRow {
  id: number;
  iid: number;
  title: string;
  state: IssueState;
  author: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  weight: number | null;
  confidential: boolean;
}

export function readIssueRows(raw: unknown): IssueRow[] {
  const rows: IssueRow[] = [];
  for (const item of isRecord(raw) ? list(raw.issues) : []) {
    if (!isRecord(item)) continue;
    const id = asNumber(item.id);
    const iid = asNumber(item.iid);
    if (id === null || iid === null) continue;
    rows.push({
      id,
      iid,
      title: asString(item.title) ?? "",
      state: issueState(item.state),
      author: asString(item.author) ?? "",
      labels: asStringList(item.labels),
      assignees: asStringList(item.assignees),
      milestone: asString(item.milestone),
      weight: asNumber(item.weight),
      confidential: item.confidential === true,
    });
  }
  return rows;
}

export interface IssueLink {
  kind: string;
  iid: number;
  title: string;
  state: IssueState;
}

export interface IssueEpic {
  iid: number;
  title: string;
  groupId: number;
}

export interface IssueDetail {
  iid: number;
  title: string;
  description: string;
  state: IssueState;
  author: string;
  assignees: string[];
  labels: string[];
  milestone: string | null;
  milestoneId: number | null;
  weight: number | null;
  dueDate: string | null;
  estimate: string | null;
  timeSpent: string | null;
  confidential: boolean;
  epic: IssueEpic | null;
  links: IssueLink[];
  createdAt: string;
}

export function readIssue(raw: unknown): IssueDetail | null {
  if (!isRecord(raw)) return null;
  const iid = asNumber(raw.iid);
  if (iid === null) return null;
  const links: IssueLink[] = [];
  for (const item of list(raw.links)) {
    if (!isRecord(item)) continue;
    const linked = asNumber(item.iid);
    if (linked === null) continue;
    links.push({ kind: asString(item.kind) ?? "relates", iid: linked, title: asString(item.title) ?? "", state: issueState(item.state) });
  }
  let epic: IssueEpic | null = null;
  if (isRecord(raw.epic)) {
    const epicIid = asNumber(raw.epic.iid);
    const groupId = asNumber(raw.epic.group_id);
    if (epicIid !== null && groupId !== null) epic = { iid: epicIid, title: asString(raw.epic.title) ?? "", groupId };
  }
  return {
    iid,
    title: asString(raw.title) ?? "",
    description: asString(raw.description) ?? "",
    state: issueState(raw.state),
    author: asString(raw.author) ?? "",
    assignees: asStringList(raw.assignees),
    labels: asStringList(raw.labels),
    milestone: asString(raw.milestone),
    milestoneId: asNumber(raw.milestone_id),
    weight: asNumber(raw.weight),
    dueDate: asString(raw.due_date),
    estimate: asString(raw.estimate),
    timeSpent: asString(raw.time_spent),
    confidential: raw.confidential === true,
    epic,
    links,
    createdAt: asString(raw.created_at) ?? "",
  };
}

export interface NoteItem {
  id: number;
  author: string;
  body: string;
  system: boolean;
  createdAt: string;
}

export function readNotes(raw: unknown): NoteItem[] {
  return readNoteList(isRecord(raw) ? raw.notes : null);
}

function readNoteList(value: unknown): NoteItem[] {
  const notes: NoteItem[] = [];
  for (const item of list(value)) {
    if (!isRecord(item)) continue;
    const id = asNumber(item.id);
    if (id === null) continue;
    notes.push({
      id,
      author: asString(item.author) ?? "",
      body: asString(item.body) ?? "",
      system: item.system === true,
      createdAt: asString(item.created_at) ?? "",
    });
  }
  return notes;
}

export interface MilestoneInfo {
  id: number;
  title: string;
  start: string;
  due: string;
  timeZone: string;
  state: string;
  opened: number;
  closed: number;
}

export function readMilestone(raw: unknown): MilestoneInfo | null {
  if (!isRecord(raw)) return null;
  const id = asNumber(raw.id);
  if (id === null) return null;
  const counts = isRecord(raw.issues) ? raw.issues : {};
  return {
    id,
    title: asString(raw.title) ?? "",
    start: asString(raw.start) ?? "",
    due: asString(raw.due) ?? "",
    timeZone: asString(raw.time_zone) ?? "UTC",
    state: asString(raw.state) ?? "active",
    opened: asNumber(counts.opened) ?? 0,
    closed: asNumber(counts.closed) ?? 0,
  };
}

export interface BurndownPoint {
  day: string;
  remaining: number;
  future: boolean;
}

export function readBurndown(raw: unknown): BurndownPoint[] {
  const points: BurndownPoint[] = [];
  for (const item of isRecord(raw) ? list(raw.points) : []) {
    if (!isRecord(item)) continue;
    const day = asString(item.day);
    const remaining = asNumber(item.remaining);
    if (day === null || remaining === null) continue;
    points.push({ day, remaining, future: item.future === true });
  }
  return points;
}

export interface EpicIssue {
  project: string;
  iid: number;
  title: string;
  milestone: string | null;
}

export interface EpicChild {
  iid: number;
  title: string;
}

export interface EpicDetail {
  iid: number;
  title: string;
  description: string;
  author: string;
  state: IssueState;
  confidential: boolean;
  parent: number | null;
  children: EpicChild[];
  issues: EpicIssue[];
  labels: string[];
  startDate: string | null;
  dueDate: string | null;
  notes: NoteItem[];
}

export function readEpic(raw: unknown): EpicDetail | null {
  if (!isRecord(raw)) return null;
  const iid = asNumber(raw.iid);
  if (iid === null) return null;
  const children: EpicChild[] = [];
  for (const item of list(raw.children)) {
    if (!isRecord(item)) continue;
    const child = asNumber(item.iid);
    if (child !== null) children.push({ iid: child, title: asString(item.title) ?? "" });
  }
  const issues: EpicIssue[] = [];
  for (const item of list(raw.issues)) {
    if (!isRecord(item)) continue;
    const issue = asNumber(item.iid);
    if (issue !== null) issues.push({ project: asString(item.project) ?? "", iid: issue, title: asString(item.title) ?? "", milestone: asString(item.milestone) });
  }
  const labels: string[] = [];
  for (const item of list(raw.labels)) {
    if (typeof item === "string") labels.push(item);
    else if (isRecord(item) && typeof item.name === "string") labels.push(item.name);
  }
  return {
    iid,
    title: asString(raw.title) ?? "",
    description: asString(raw.description) ?? "",
    author: asString(raw.author) ?? "",
    state: issueState(raw.state),
    confidential: raw.confidential === true,
    parent: asNumber(raw.parent),
    children,
    issues,
    labels,
    startDate: asString(raw.start_date),
    dueDate: asString(raw.due_date),
    notes: readNoteList(raw.notes),
  };
}

export interface BoardCard {
  issue: number;
  iid: number;
  title: string;
  weight: number | null;
  labels: string[];
  version: number;
  position: number;
  state: IssueState;
  assignees: string[];
  milestone: string | null;
  confidential: boolean;
  project: string | null;
  projectId: number | null;
}

export interface BoardList {
  id: number;
  title: string;
  kind: string;
  cards: BoardCard[];
}

export interface BoardData {
  id: number;
  name: string;
  kind: string;
  projectId: number | null;
  groupId: number | null;
  lists: BoardList[];
}

function readCard(item: unknown): BoardCard | null {
  if (!isRecord(item)) return null;
  const issue = asNumber(item.issue);
  const iid = asNumber(item.iid);
  if (issue === null || iid === null) return null;
  return {
    issue,
    iid,
    title: asString(item.title) ?? "",
    weight: asNumber(item.weight),
    labels: asStringList(item.labels),
    version: asNumber(item.version) ?? 0,
    position: asNumber(item.position) ?? 0,
    state: issueState(item.state),
    assignees: asStringList(item.assignees),
    milestone: asString(item.milestone),
    confidential: item.confidential === true,
    project: asString(item.project),
    projectId: asNumber(item.project_id),
  };
}

export function readBoard(raw: unknown): BoardData {
  const body = isRecord(raw) ? raw : {};
  const lists: BoardList[] = [];
  for (const item of list(body.lists)) {
    if (!isRecord(item)) continue;
    const id = asNumber(item.id);
    if (id === null) continue;
    const cards: BoardCard[] = [];
    for (const entry of list(item.cards)) {
      const card = readCard(entry);
      if (card) cards.push(card);
    }
    lists.push({ id, title: asString(item.title) ?? "", kind: asString(item.kind) ?? "list", cards });
  }
  return {
    id: asNumber(body.id) ?? 0,
    name: asString(body.name) ?? "",
    kind: asString(body.kind) ?? "label",
    projectId: asNumber(body.project_id),
    groupId: asNumber(body.group_id),
    lists,
  };
}

export interface MoveOutcome {
  card: BoardCard | null;
  order: Array<{ id: number; issueIds: number[] }>;
  notes: string[];
}

export function readMoveOutcome(raw: unknown): MoveOutcome {
  const body = isRecord(raw) ? raw : {};
  const order: MoveOutcome["order"] = [];
  for (const item of list(body.lists)) {
    if (!isRecord(item)) continue;
    const id = asNumber(item.id);
    if (id === null) continue;
    order.push({ id, issueIds: list(item.issue_ids).filter((entry): entry is number => typeof entry === "number") });
  }
  return { card: readCard(body.card), order, notes: asStringList(body.notes) };
}

export interface NamedItem {
  id: number;
  path: string;
}

export function readNamedList(raw: unknown, key: string): NamedItem[] {
  const items: NamedItem[] = [];
  for (const item of isRecord(raw) ? list(raw[key]) : []) {
    if (!isRecord(item)) continue;
    const id = asNumber(item.id);
    const path = asString(item.path);
    if (id !== null && path !== null) items.push({ id, path });
  }
  return items;
}

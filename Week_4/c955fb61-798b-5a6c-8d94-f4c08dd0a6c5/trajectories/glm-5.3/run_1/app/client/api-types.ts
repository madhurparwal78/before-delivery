// Shared client types: the server's one read model, as the browser reads it.

export type IsoDate = string;
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';
export type ItemKind = 'task' | 'milestone' | 'group';

export interface Assignee {
  userId: string;
  name: string;
  hours: number;
}

export interface Item {
  id: string;
  row: number;
  name: string;
  kind: ItemKind;
  group: string | null;
  chosenStart: IsoDate | null;
  start: IsoDate | null;
  end: IsoDate | null;
  duration: number;
  percent: number;
  critical: boolean;
  float: number | null;
  late: boolean;
  version: number;
  assignees: Assignee[];
  baseline: { start: IsoDate; end: IsoDate; variance: number } | null;
}

export interface Link {
  id: string;
  from: string;
  to: string;
  type: LinkType;
  lag: number;
  critical: boolean;
}

export interface Project {
  id: string;
  name: string;
  finish: IsoDate | null;
  holidays: { date: IsoDate; name: string }[];
  items: Item[];
  links: Link[];
  baseline: { name: string; finish: IsoDate; finishVariance: number } | null;
}

export interface Me {
  user: { id: string; name: string; email: string };
  workspaces: { id: string; name: string; role: Role }[];
}

export type Role = 'owner' | 'editor' | 'viewer';

export interface AppConfig {
  today: IsoDate;
  timeZone: string;
  assignNoticeDelaySeconds: number;
  presenceTimeoutSeconds: number;
  knockOnMs: number;
  knockOnStaggerMs: number;
  finishMotionMs: number;
}

export interface ExportRow {
  id: string;
  format: 'csv' | 'pdf';
  filename: string;
  downloadUrl: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  author: { userId: string; name: string };
  text: string;
  createdAt: string;
}

export interface WorkloadDay {
  date: IsoDate;
  hours: number;
  over: boolean;
  assignments: { project: string; item: string; hours: number }[];
}

export interface WorkloadPerson {
  userId: string;
  name: string;
  capacity: number;
  overDays: number;
  days: WorkloadDay[];
}

export interface Workload {
  from: IsoDate;
  days: IsoDate[];
  people: WorkloadPerson[];
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function weekday(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function addDays(date: IsoDate, n: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number);
  const epoch = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const dt = new Date(epoch);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** `Mon 1 Mar 2027`. */
export function longDate(date: IsoDate): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS[weekday(date)]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** `Mon 1 Mar`. */
export function shortDate(date: IsoDate): string {
  const [, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS[weekday(date)]} ${d} ${MONTHS[m - 1]}`;
}

/** The Monday of the week of `date`. */
export function weekMonday(date: IsoDate): IsoDate {
  return addDays(date, 1 - weekday(date));
}

export function hoursText(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function varianceText(n: number): string {
  if (n === 0) return 'On baseline';
  if (n === 1) return '1 working day later than baseline';
  if (n === -1) return '1 working day earlier than baseline';
  if (n > 0) return `${n} working days later than baseline`;
  return `${n} working days earlier than baseline`;
}

export const LINK_TYPE_WORDS: Record<LinkType, string> = {
  FS: 'finish to start',
  SS: 'start to start',
  FF: 'finish to finish',
  SF: 'start to finish',
};

export function formatLag(lag: number): string {
  return lag > 0 ? `+${lag}` : String(lag);
}

/** Canonical predecessors text for one item, in predecessor row order. */
export function predecessorsText(project: Project, itemId: string): string {
  const item = project.items.find((entry) => entry.id === itemId);
  if (item === undefined) return '';
  return project.links
    .filter((link) => link.to === itemId)
    .map((link) => ({ link, predecessor: project.items.find((entry) => entry.id === link.from) }))
    .filter((entry): entry is { link: Link; predecessor: Item } => entry.predecessor !== undefined)
    .sort((a, b) => a.predecessor.row - b.predecessor.row)
    .map(({ link, predecessor }) => `${predecessor.row}${link.type}${link.lag === 0 ? '' : formatLag(link.lag)}`)
    .join(', ');
}

/** The published bar description. */
export function barDescription(project: Project, item: Item): string {
  const parts: string[] = [];
  if (item.kind === 'milestone') parts.push(`Milestone on ${longDate(item.start ?? '')}`);
  else if (item.kind === 'group') parts.push(`Group from ${longDate(item.start ?? '')} to ${longDate(item.end ?? '')}`);
  else parts.push(`Starts ${longDate(item.start ?? '')}, ends ${longDate(item.end ?? '')}`);

  if (item.kind === 'task') {
    parts.push(`${item.duration === 1 ? '1 working day' : `${item.duration} working days`}, ${item.percent}% complete`);
  } else if (item.kind === 'milestone') {
    parts.push(item.percent === 100 ? 'Done' : 'Not done');
  } else {
    parts.push(`${item.percent}% complete`);
  }
  if (item.critical) parts.push('Critical');
  if (item.late) parts.push('Late');
  if (item.baseline !== null && item.kind !== 'group') parts.push(varianceText(item.baseline.variance));
  const incoming = project.links
    .filter((link) => link.to === item.id)
    .map((link) => ({ link, predecessor: project.items.find((entry) => entry.id === link.from) }))
    .filter((entry): entry is { link: Link; predecessor: Item } => entry.predecessor !== undefined)
    .sort((a, b) => a.predecessor.row - b.predecessor.row);
  for (const { link, predecessor } of incoming) {
    const lag = link.lag === 0 ? 'lag 0' : `lag ${formatLag(link.lag)}`;
    parts.push(`Waits for ${predecessor.name}, ${LINK_TYPE_WORDS[link.type]}, ${lag}`);
  }
  return parts.join('. ') + '.';
}

/** The fewest links from `fromId` to `toId`, capped at 12. */
export function linkDepth(project: Project, fromId: string | null, toId: string): number {
  if (fromId === null) return 0;
  if (fromId === toId) return 0;
  const adjacency = new Map<string, string[]>();
  for (const link of project.links) {
    const list = adjacency.get(link.from) ?? [];
    list.push(link.to);
    adjacency.set(link.from, list);
  }
  const seen = new Set<string>([fromId]);
  let frontier = [fromId];
  let depth = 0;
  while (frontier.length > 0 && depth < 12) {
    depth += 1;
    const next: string[] = [];
    for (const node of frontier) {
      for (const target of adjacency.get(node) ?? []) {
        if (seen.has(target)) continue;
        if (target === toId) return depth;
        seen.add(target);
        next.push(target);
      }
    }
    frontier = next;
  }
  return depth;
}

export const THEATRE_NAME = 'Kettleyard Playhouse';
export const SHOW_TITLE = 'The Lantern Keepers';
export const TASK_ID_PREFIX = 'STG-';

export const STATUSES = [
  'triage',
  'backlog',
  'todo',
  'in_progress',
  'done',
  'cancelled',
  'duplicate',
] as const;
export type Status = (typeof STATUSES)[number];

export type OpenStatus = 'backlog' | 'todo' | 'in_progress';

export const STATUS_NAMES: Record<Status, string> = {
  triage: 'Triage',
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
  duplicate: 'Duplicate',
};

/** The four status columns of board view, in column order. */
export const COLUMN_STATUSES = ['backlog', 'todo', 'in_progress', 'done'] as const;
export type ColumnStatus = (typeof COLUMN_STATUSES)[number];

/** List view group order when grouping by status. */
export const STATUS_GROUP_ORDER = [
  'backlog',
  'todo',
  'in_progress',
  'done',
  'cancelled',
] as const;

export const PRIORITIES = [0, 1, 2, 3, 4] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_NAMES: Record<Priority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

/** Urgent first, No priority last. */
export const PRIORITY_RANK: Record<Priority, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 0: 4 };

export type DepartmentKey =
  | 'carpentry'
  | 'paint'
  | 'lighting'
  | 'sound'
  | 'wardrobe'
  | 'props';

export interface Label {
  key: string;
  name: string;
}

export interface Department {
  key: DepartmentKey;
  name: string;
  labels: Label[];
}

export const DEPARTMENTS: Department[] = [
  { key: 'carpentry', name: 'Carpentry', labels: [] },
  { key: 'paint', name: 'Paint', labels: [] },
  {
    key: 'lighting',
    name: 'Lighting',
    labels: [
      { key: 'focus', name: 'Focus' },
      { key: 'programming', name: 'Programming' },
      { key: 'electrics', name: 'Electrics' },
    ],
  },
  {
    key: 'sound',
    name: 'Sound',
    labels: [
      { key: 'cues', name: 'Cues' },
      { key: 'system', name: 'System' },
    ],
  },
  {
    key: 'wardrobe',
    name: 'Wardrobe',
    labels: [
      { key: 'fitting', name: 'Fitting' },
      { key: 'alteration', name: 'Alteration' },
      { key: 'quick-change', name: 'Quick-change' },
    ],
  },
  { key: 'props', name: 'Props', labels: [] },
];

export function department(key: string | null): Department | undefined {
  return DEPARTMENTS.find((d) => d.key === key);
}

export function departmentName(key: string | null): string {
  return department(key)?.name ?? '';
}

export interface CrewMember {
  handle: string;
  name: string;
  role: string;
  department: DepartmentKey | null;
}

export const CREW: CrewMember[] = [
  { handle: 'maya', name: 'Maya Okonjo', role: 'Stage manager', department: null },
  { handle: 'devi', name: 'Devi Rangan', role: 'Production carpenter', department: 'carpentry' },
  { handle: 'sasha', name: 'Sasha Bell', role: 'Scenic charge painter', department: 'paint' },
  { handle: 'ines', name: 'Ines Hart', role: 'Lighting lead', department: 'lighting' },
  { handle: 'kofi', name: 'Kofi Mensah', role: 'Sound lead', department: 'sound' },
  { handle: 'ruth', name: 'Ruth Alder', role: 'Costume lead', department: 'wardrobe' },
  { handle: 'oren', name: 'Oren Vale', role: 'Props lead', department: 'props' },
  { handle: 'leon', name: 'Leon Park', role: 'Director', department: null },
];

export const DEFAULT_ACTOR = 'maya';

export function crewMember(handle: string | null): CrewMember | undefined {
  return CREW.find((c) => c.handle === handle);
}

export function crewName(handle: string | null): string {
  return crewMember(handle)?.name ?? '';
}

export type CycleKey = 'rehearsal-1' | 'rehearsal-2' | 'rehearsal-3' | 'tech' | 'previews';

export const CYCLE_KEYS: CycleKey[] = [
  'rehearsal-1',
  'rehearsal-2',
  'rehearsal-3',
  'tech',
  'previews',
];

export const CYCLE_NAMES: Record<CycleKey, string> = {
  'rehearsal-1': 'Rehearsal 1',
  'rehearsal-2': 'Rehearsal 2',
  'rehearsal-3': 'Rehearsal 3',
  tech: 'Tech',
  previews: 'Previews',
};

export const ATTACHMENT_KINDS = ['sketch', 'plot', 'rendering'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_NAMES: Record<AttachmentKind, string> = {
  sketch: 'Sketch',
  plot: 'Plot',
  rendering: 'Rendering',
};

export const UPLOAD_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export const MAX_UPLOAD_BYTES = 10_000_000;
export const MAX_MULTIPART_BYTES = 10_100_000;
export const MAX_JSON_BYTES = 65_536;
export const MAX_TITLE_LENGTH = 140;
export const MAX_DETAILS_LENGTH = 4000;
export const MAX_BULK_TASKS = 100;
export const DOWNLOAD_LINK_SECONDS = 60;

export function taskId(number: number): string {
  return `${TASK_ID_PREFIX}${number}`;
}

export function taskNumber(id: string): number | null {
  if (!id.startsWith(TASK_ID_PREFIX)) return null;
  const rest = id.slice(TASK_ID_PREFIX.length);
  if (!/^[0-9]+$/.test(rest)) return null;
  return Number(rest);
}

export function isOpenStatus(status: Status): status is OpenStatus {
  return status === 'backlog' || status === 'todo' || status === 'in_progress';
}

export function isClosedStatus(status: Status): boolean {
  return status === 'done' || status === 'cancelled' || status === 'duplicate';
}

/** The only place the status edges live. */
const LEGAL_EDGES: Record<Status, Status[]> = {
  backlog: ['todo', 'in_progress', 'done', 'cancelled'],
  todo: ['backlog', 'in_progress', 'done', 'cancelled'],
  in_progress: ['backlog', 'todo', 'done', 'cancelled'],
  done: ['todo', 'in_progress'],
  cancelled: ['backlog'],
  triage: [],
  duplicate: [],
};

export function isLegalTransition(from: Status, to: Status): boolean {
  if (from === to) return true;
  return LEGAL_EDGES[from].includes(to);
}

/** Triage and duplicate tasks take no edits at all. */
export function isEditableStatus(status: Status): boolean {
  return status !== 'triage' && status !== 'duplicate';
}

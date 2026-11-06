// The production's fixed vocabulary, shared by the server and the browser.

export const THEATRE = "Kettleyard Playhouse";
export const SHOW = "The Lantern Keepers";

export type StatusKey = "triage" | "backlog" | "todo" | "in_progress" | "done" | "cancelled" | "duplicate";

export const STATUS_NAMES: Record<StatusKey, string> = {
  triage: "Triage",
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
  duplicate: "Duplicate",
};

export const STATUSES = Object.keys(STATUS_NAMES) as StatusKey[];

// The status rules, decided here for the server and the screen alike.
export const OPEN_STATUSES: readonly StatusKey[] = ["backlog", "todo", "in_progress"];
export const isOpen = (status: StatusKey): boolean => OPEN_STATUSES.includes(status);
export const isEditable = (status: StatusKey): boolean => status !== "triage" && status !== "duplicate";
export const canMove = (from: StatusKey, to: StatusKey): boolean => {
  if (isOpen(from)) return to !== from && (isOpen(to) || to === "done" || to === "cancelled");
  if (from === "done") return to === "todo" || to === "in_progress";
  if (from === "cancelled") return to === "backlog";
  return false;
};

export const PRIORITY_NAMES = ["No priority", "Urgent", "High", "Medium", "Low"] as const;

interface CrewMember {
  handle: string;
  name: string;
  role: string;
  department: string | null;
}

export const CREW: CrewMember[] = [
  { handle: "maya", name: "Maya Okonjo", role: "Stage manager", department: null },
  { handle: "devi", name: "Devi Rangan", role: "Production carpenter", department: "carpentry" },
  { handle: "sasha", name: "Sasha Bell", role: "Scenic charge painter", department: "paint" },
  { handle: "ines", name: "Ines Hart", role: "Lighting lead", department: "lighting" },
  { handle: "kofi", name: "Kofi Mensah", role: "Sound lead", department: "sound" },
  { handle: "ruth", name: "Ruth Alder", role: "Costume lead", department: "wardrobe" },
  { handle: "oren", name: "Oren Vale", role: "Props lead", department: "props" },
  { handle: "leon", name: "Leon Park", role: "Director", department: null },
];

interface Label {
  key: string;
  name: string;
}

export interface Department {
  key: string;
  name: string;
  labels: Label[];
}

export const DEPARTMENTS: Department[] = [
  { key: "carpentry", name: "Carpentry", labels: [] },
  { key: "paint", name: "Paint", labels: [] },
  {
    key: "lighting",
    name: "Lighting",
    labels: [
      { key: "focus", name: "Focus" },
      { key: "programming", name: "Programming" },
      { key: "electrics", name: "Electrics" },
    ],
  },
  {
    key: "sound",
    name: "Sound",
    labels: [
      { key: "cues", name: "Cues" },
      { key: "system", name: "System" },
    ],
  },
  {
    key: "wardrobe",
    name: "Wardrobe",
    labels: [
      { key: "fitting", name: "Fitting" },
      { key: "alteration", name: "Alteration" },
      { key: "quick-change", name: "Quick-change" },
    ],
  },
  { key: "props", name: "Props", labels: [] },
];

export const CYCLES = [
  { key: "rehearsal-1", name: "Rehearsal 1" },
  { key: "rehearsal-2", name: "Rehearsal 2" },
  { key: "rehearsal-3", name: "Rehearsal 3" },
  { key: "tech", name: "Tech" },
  { key: "previews", name: "Previews" },
] as const;

export type CycleKey = (typeof CYCLES)[number]["key"];

export const ATTACHMENT_KINDS = ["sketch", "plot", "rendering"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const crewByHandle = (handle: string | null | undefined): CrewMember | undefined =>
  CREW.find((member) => member.handle === handle);

export const departmentByKey = (key: string | null | undefined): Department | undefined =>
  DEPARTMENTS.find((department) => department.key === key);

export const cycleName = (key: string | null | undefined): string | undefined =>
  CYCLES.find((cycle) => cycle.key === key)?.name;

// Field messages the API returns and the forms show, word for word.
export const FIELD_MESSAGES = {
  titleEmpty: "Give the task a title.",
  titleLong: "Keep it to 140 characters.",
  details: "Keep details to 4,000 characters.",
  department: "Choose a department.",
  priority: "Choose a priority from 0 to 4.",
  crew: "Choose someone on the crew list.",
  status: "Choose a status.",
  label: "Choose a label this department uses.",
  cycle: "Choose the current cycle or a later one.",
  parent: "Choose an existing task that is not a sub-task.",
  blocksSelf: "A task can't block itself.",
  blocksUnknown: "Choose an existing task.",
  tasks: "Choose 1 to 100 tasks.",
  set: "Choose a change to make.",
  decision: "Choose accept, decline or merge.",
  reason: "Say why it was declined.",
  duplicateOf: "Choose an accepted task to merge into.",
  requestEmpty: "Say what you need.",
  requestLong: "Keep it to 140 characters.",
  requester: "Add your name.",
  file: "Attach a PDF, PNG or JPEG file.",
  kind: "Choose sketch, plot or rendering.",
  idempotencyKey: "Use 1 to 100 visible characters.",
  filter: "That filter value isn't recognised.",
} as const;

export const TITLE_MAX = 140;
export const DETAILS_MAX = 4000;
export const BULK_MAX = 100;
export const UPLOAD_MAX_BYTES = 10_000_000;

// Wire shapes.

export interface Task {
  id: string;
  number: number;
  title: string;
  details: string;
  department: string | null;
  label: string | null;
  status: StatusKey;
  priority: number;
  owner: string | null;
  cycle: string | null;
  parent: string | null;
  subtasks: { done: number; total: number } | null;
  blocked_by: string[];
  blocks: string[];
  blocked: boolean;
  duplicate_of: string | null;
  request: string | null;
  version: number;
  updated_at: string;
}

export interface CycleSpan {
  key: string;
  name: string;
  starts_at: string;
  ends_at: string | null;
  current: boolean;
  done: number;
  total: number;
}

export interface Snapshot {
  seq: number;
  triage: number;
  columns: { backlog: number; todo: number; in_progress: number; done: number; cancelled: number };
  blocked: number;
  cycles: CycleSpan[];
}

export interface Freed {
  id: string;
  depth: number;
  order: number;
  freed_by: string;
}

export interface Reblocked {
  id: string;
  order: number;
}

export interface Attachment {
  id: string;
  task: string;
  file_name: string;
  kind: AttachmentKind;
  size: number;
  content_type: string;
  created_at: string;
  current: boolean;
}

export interface ChangeResult {
  change: number;
  undoable: boolean;
  tasks: Task[];
  cascade: Freed[];
  reblocked: Reblocked[];
  snapshot: Snapshot;
  request?: { id: string; status: string; task: string | null };
}

export type ChangeKind = "create" | "edit" | "bulk" | "undo" | "relation" | "decision" | "pull" | "rollover" | "attachment";

export interface ChangeEvent extends Omit<ChangeResult, "tasks"> {
  kind: ChangeKind;
  tasks?: Task[];
  attachment?: Attachment;
}

export interface ActivityEntry {
  id: number;
  task: string;
  at: string;
  actor: { handle: string; name: string } | null;
  kind: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  change: number | null;
}

export interface IntakeRequest {
  id: string;
  title: string;
  details: string;
  requester: string;
  department: string | null;
  status: "pending" | "accepted" | "declined" | "merged";
  task: string | null;
  created: string;
  decided_at: string | null;
}

export interface ServiceStatus {
  intake: "up" | "down";
  plot_storage: "up" | "down";
}

export interface Production {
  theatre: string;
  show: string;
  time_zone: string;
  today: string;
  opening_night: string;
  days_to_opening: number;
  current_cycle: string;
  departments: Department[];
  crew: CrewMember[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    current?: Task | Task[];
    blocked_by?: string[];
    tasks?: string[];
  };
}

export const taskId = (n: number): string => `STG-${n}`;
export const taskNumber = (id: string): number | null => {
  const match = /^STG-(\d{1,9})$/.exec(id);
  return match ? Number(match[1]) : null;
};

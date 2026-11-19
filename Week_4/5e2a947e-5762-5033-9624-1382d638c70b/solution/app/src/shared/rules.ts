import type { ExportState, LinkState, PresentationState, PublicOp, Role } from './model.ts';

/** The permission table: which roles may do what. */
const CAPABILITIES = {
  comment: ['owner', 'editor', 'commenter'],
  edit: ['owner', 'editor'],
  lock: ['owner', 'editor'],
  unlock_any: ['owner'],
  restore: ['owner'],
  restrict: ['owner'],
  manage: ['owner'],
  present: ['owner'],
  delete_map: ['owner'],
  see_restricted: ['owner', 'editor'],
} as const satisfies Record<string, readonly Role[]>;

type Capability = keyof typeof CAPABILITIES;

/** The capability each operation kind needs. */
export const OP_CAPABILITY: Record<PublicOp['kind'], Capability> = {
  add: 'edit',
  add_floating: 'edit',
  title: 'edit',
  note: 'edit',
  move: 'edit',
  float_move: 'edit',
  delete: 'edit',
  task: 'edit',
  style: 'edit',
  pin: 'edit',
  link_add: 'edit',
  link_remove: 'edit',
  boundary_add: 'edit',
  boundary_remove: 'edit',
  lock: 'lock',
  unlock: 'lock',
  restrict: 'restrict',
  layout: 'edit',
  theme: 'edit',
  slides: 'present',
  custom_colour: 'edit',
};

export function can(role: Role, capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly Role[]).includes(role);
}

type Transitions<S extends string> = Partial<Record<S, readonly S[]>>;

export const PRESENTATION_TRANSITIONS: Transitions<PresentationState> = {
  waiting: ['live', 'ended'],
  live: ['paused', 'ended'],
  paused: ['live', 'ended'],
};

/** The states the presenter may move a show to; pausing belongs to the server. */
export const PRESENTER_TARGETS: readonly PresentationState[] = ['live', 'ended'];

/** Slides are stepped only while a show is live. */
export const canStep = (state: PresentationState): boolean => state === 'live';

export const LINK_TRANSITIONS: Transitions<LinkState> = {
  active: ['expired', 'revoked'],
};

export const EXPORT_TRANSITIONS: Transitions<ExportState> = {
  queued: ['running'],
  running: ['running', 'ready', 'failed'],
  failed: ['running'],
};

export function canTransition<S extends string>(table: Transitions<S>, from: S, to: S): boolean {
  return table[from]?.includes(to) ?? false;
}

export const LIMITS = {
  json_bytes: 1_000_000,
  title_chars: 200,
  note_chars: 5_000,
  label_chars: 40,
  comment_chars: 2_000,
  version_name_chars: 60,
  display_name_chars: 30,
  map_title_chars: 200,
  ops_per_group: 500,
  custom_colours: 8,
  export_steps: [20, 40, 60, 80, 100],
} as const;

export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
/** An id a client may choose: the published pattern, and never a name every object already has. */
export const isClientId = (value: unknown): value is string => typeof value === 'string' && ID_PATTERN.test(value) && !(value in Object.prototype);
export const COLOUR_PATTERN = /^#[0-9a-f]{6}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date written YYYY-MM-DD. */
export function validDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const COPY = {
  link_scheme: 'Links must start with http:// or https://.',
  read_only: 'You can view this map but not edit it.',
  root_delete: "The central topic can't be deleted.",
  dependency_loop: 'That would make a dependency loop.',
  missing_topic: 'That topic no longer exists.',
  focus_deleted: 'This branch was deleted. Showing the whole map.',
  nothing_undo: 'Nothing to undo.',
  nothing_redo: 'Nothing to redo.',
  undone: 'Undone.',
  redone: 'Redone.',
  nothing_paste: 'Nothing to paste.',
  empty_map: 'Press Tab to add the first branch.',
  storage_upload: 'File storage is unavailable. Nothing was added. Try again in a moment.',
  storage_version: 'File storage is unavailable. The version was not saved. Try again in a moment.',
  storage_restore: 'File storage is unavailable. Nothing was restored. Try again in a moment.',
  storage_export: 'Export failed: file storage is unavailable.',
  wrong_type: 'Only PNG and JPEG images can be attached.',
} as const;

export const noticeTooLarge = (limit: number): string => `This image is larger than ${limit} bytes.`;
export const noticeQuota = (quota: number): string => `This map's images would pass its ${quota} byte limit.`;

export const noticeCycle = (title: string): string => `Move undone: ${title} can't go inside its own branch.`;
export const noticeMovedAfter = (user: string, title: string): string => `${user} moved ${title} after you.`;
export const noticeDeletedUnder = (user: string): string => `${user} deleted this branch. Your edit is in Recovered edits.`;
export const noticeOrder = (user: string): string => `Order changed: ${user} reordered these topics too.`;
export const noticeLockedMove = (title: string): string => `Nothing moved: ${title} is locked.`;
export const noticeLockedEdit = (title: string, user: string): string => `${title} is locked by ${user}.`;
export const noticeUndoSkipped = (user: string, title: string): string => `Can't undo: ${user} changed ${title} after you.`;
export const noticeRedoSkipped = (user: string, title: string): string => `Can't redo: ${user} changed ${title} after you.`;
export const noticeRole = (role: Role): string => `Your role is now ${role}.`;
export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

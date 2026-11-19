export type MemberRole = 'owner' | 'member' | 'operator';
export type MemberStatus = 'active' | 'invited' | 'pending_billing';
export type WorkspaceState = 'trialing' | 'active' | 'past_due' | 'read_only' | 'cancelled';
export type TaskStatus = 'open' | 'done';
export type RoutineRepeats = 'daily' | 'weekdays';

export interface MemberDto {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  timeZone: string;
  thresholdMinutes: number;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  state: WorkspaceState;
  trialEndsAt: string;
  writable: boolean;
}

export interface SessionDto {
  id: string;
  taskId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  start: string;
  end: string;
  version: number;
}

export interface TaskDto {
  id: string;
  title: string;
  estimateMinutes: number | null;
  dayDate: string | null;
  position: number;
  status: TaskStatus;
  source: string | null;
  externalId: string | null;
  dueDate: string | null;
  version: number;
  session: SessionDto | null;
}

export interface DayDto {
  date: string;
  label: string;
  taskMinutes: number;
  meetingMinutes: number;
  routineMinutes: number;
  plannedMinutes: number;
  overByMinutes: number;
  tasks: TaskDto[];
}

export interface BoardDto {
  today: string;
  timeZone: string;
  thresholdMinutes: number;
  days: DayDto[];
  backlog: TaskDto[];
}

export interface RoutineDto {
  id: string;
  name: string;
  startTime: string;
  durationMinutes: number;
  repeats: RoutineRepeats;
}

export type CalendarItemKind = 'session' | 'routine' | 'meeting';

export interface CalendarItemDto {
  kind: CalendarItemKind;
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  start: string;
  end: string;
  version?: number;
}

export interface CalendarDto {
  timeZone: string;
  items: CalendarItemDto[];
}

export interface TaskImportResultDto {
  batchId: string;
  created: number;
  updated: number;
  unchanged: number;
  merged: number;
  rejected: { line: number; reason: string }[];
  orphaned: { externalId: string; title: string }[];
}

export interface CalendarImportResultDto {
  batchId: string;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

export interface ShutdownPreviewDto {
  date: string;
  done: { id: string; title: string }[];
  carriedOver: { id: string; title: string }[];
  tomorrowFirst: { title: string; startTime: string } | null;
}

export interface ShutdownResultDto extends ShutdownPreviewDto {
  digest: 'sent' | 'queued' | 'already_sent';
}

export interface WorkspaceMemberDto {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
}

export interface SeatsDto {
  active: number;
  billed: number | null;
}

export interface ReviewDto {
  week: string;
  members: { memberId: string; name: string; plannedMinutes: number; doneMinutes: number }[];
  totals: { plannedMinutes: number; doneMinutes: number };
}

export interface OpsWorkspaceDto {
  id: string;
  name: string;
  state: WorkspaceState;
  trialEndsAt: string;
  activeSeats: number;
  billedSeats: number | null;
  lastBillingEventAt: string | null;
  outbox: { pending: number; sent: number };
  imports: { batches: number; lastAt: string | null };
}

export interface MeDto {
  member: MemberDto;
  workspace: WorkspaceDto | null;
  today: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  current?: TaskDto | SessionDto;
}

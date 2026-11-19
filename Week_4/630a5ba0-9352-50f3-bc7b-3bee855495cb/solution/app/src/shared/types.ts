// The API's objects, exactly as the brief names them (Backend › API › Objects).

export type Role = "owner" | "member" | "operator";
export type WorkspaceState = "trialing" | "active" | "past_due" | "read_only" | "cancelled";
export type TaskStatus = "open" | "done";
export type Repeats = "daily" | "weekdays";
export type MemberStatus = "active" | "invited" | "pending_billing";

export type Member = {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  timeZone: string;
  thresholdMinutes: number;
};

export type Workspace = {
  id: string;
  name: string;
  state: WorkspaceState;
  trialEndsAt: string;
  writable: boolean;
};

export type Session = {
  id: string;
  taskId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  start: string;
  end: string;
  version: number;
};

export type Task = {
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
  session: Session | null;
};

export type Day = {
  date: string;
  label: string;
  taskMinutes: number;
  meetingMinutes: number;
  routineMinutes: number;
  plannedMinutes: number;
  overByMinutes: number;
  tasks: Task[];
};

export type Routine = {
  id: string;
  name: string;
  startTime: string;
  durationMinutes: number;
  repeats: Repeats;
};

export type CalendarItem = {
  kind: "session" | "routine" | "meeting";
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  start: string;
  end: string;
  version?: number;
  taskId?: string;
};

export type Board = {
  today: string;
  timeZone: string;
  thresholdMinutes: number;
  days: Day[];
  backlog: Task[];
};

export type ShutdownPreview = {
  date: string;
  done: { id: string; title: string }[];
  carriedOver: { id: string; title: string }[];
  tomorrowFirst: { title: string; startTime: string } | null;
};

export type WorkspaceMember = {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  status: MemberStatus;
};

export type Seats = { active: number; billed: number | null };

export type Review = {
  week: string;
  members: { memberId: string; name: string | null; plannedMinutes: number; doneMinutes: number }[];
  totals: { plannedMinutes: number; doneMinutes: number };
};

export type OpsWorkspace = {
  id: string;
  name: string;
  state: WorkspaceState;
  trialEndsAt: string;
  activeSeats: number;
  billedSeats: number | null;
  lastBillingEventAt: string | null;
  outbox: { pending: number; sent: number };
  imports: { batches: number; lastAt: string | null };
};

export type ApiError = {
  error: string;
  message: string;
  fields?: Record<string, string>;
  current?: Task | Session;
};

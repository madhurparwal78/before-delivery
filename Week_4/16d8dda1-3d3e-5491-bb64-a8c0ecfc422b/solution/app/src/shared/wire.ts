// The wire contract shared by the server and the browser: every body the REST API and the
// WebSocket send. Names follow the brief's domain terms.

export type SessionState = 'scheduled' | 'open' | 'live' | 'breakouts' | 'ended';
export type Role = 'teacher' | 'co-teacher' | 'learner';
export type ClassRole = 'owner' | 'co-teacher';
export type LessonState = 'draft' | 'uploading' | 'ready';
type FileStatus = 'pending' | 'confirmed';
export type AttendanceStatus = 'present' | 'late' | 'left_early' | 'late_left_early' | 'absent';

// ---- layout ----

export type PieceKind = 'board' | 'table' | 'seat';
export interface Piece {
  kind: PieceKind;
  column: number;
  row: number;
}
export interface Layout {
  columns: number;
  rows: number;
  pieces: Piece[];
}
export interface SeatPlace {
  seatId: string;
  table: string | null;
  row: number;
  column: number;
}
export interface TablePlace {
  tableId: string;
  row: number;
  column: number;
}
export interface LayoutResult {
  layout: Layout;
  seats: SeatPlace[];
  tables: TablePlace[];
}

// ---- accounts ----

export interface TeacherBody {
  id: string;
  email: string;
  displayName: string;
}
export type MeBody =
  | { role: 'teacher'; id: string; email: string; displayName: string }
  | { role: 'learner'; id: string; displayName: string };

// ---- classes, lessons ----

export interface ClassListItem {
  id: string;
  title: string;
  timeZone: string;
  code: string;
  role: ClassRole;
}
export interface CoTeacherBody {
  id: string;
  displayName: string;
  email: string;
}
export interface ClassSessionItem {
  id: string;
  lessonId: string;
  state: SessionState;
  startsAt: string;
  endsAt: string;
}
export interface ClassDetail extends LayoutResult {
  id: string;
  title: string;
  timeZone: string;
  code: string;
  role: ClassRole;
  coTeachers: CoTeacherBody[];
  lessons: { id: string; title: string; state: LessonState }[];
  sessions: ClassSessionItem[];
}
export interface LessonFile {
  fileId: string;
  name: string;
  number: number;
  bytes: number;
  status: FileStatus;
}
export interface Lesson {
  id: string;
  classId: string;
  title: string;
  state: LessonState;
  slides: LessonFile[];
  models: LessonFile[];
}

// ---- session snapshot ----

export interface SeatView {
  seatId: string;
  table: string | null;
  row: number;
  column: number;
  learnerId: string | null;
  displayName: string | null;
  hand: 'raised' | 'down';
  breakoutTable: string | null;
}
interface TableView {
  tableId: string;
  row: number;
  column: number;
}
interface HandView {
  learnerId: string;
  displayName: string;
}
export interface PollResult {
  option: string;
  count: number;
  percent: number;
}
export interface PollView {
  pollId: string;
  question: string;
  options: string[];
  state: 'open' | 'closed';
  counts: number[] | null;
  yourAnswer: number | null;
  /** Present once the poll is closed. */
  results: PollResult[] | null;
  total: number | null;
}
interface BreakoutView {
  tables: { tableId: string; learnerIds: string[] }[];
  remainingSeconds: number;
  warning: boolean;
  /** The round's whole length in seconds, extensions included (the ring's denominator). */
  totalSeconds: number;
}
export interface SessionSnapshot {
  id: string;
  classId: string;
  lessonId: string;
  classTitle: string;
  state: SessionState;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  startsAtUtc: string;
  endsAtUtc: string;
  slide: { current: number; total: number; fileId: string | null };
  modelFileId: string | null;
  locked: boolean;
  spotlight: string | null;
  /** The saved room: grid size and the board's left column (the board is 4 cells wide on row 0). */
  room: { columns: number; rows: number; boardColumn: number };
  seats: SeatView[];
  tables: TableView[];
  hands: HandView[];
  poll: PollView | null;
  breakout: BreakoutView | null;
  you: { role: Role; learnerId: string | null };
  live: boolean;
}

export interface JoinBody {
  sessionId: string;
  learnerId: string;
}
export interface HandTakenBody {
  took: { learnerId: string; displayName: string };
  snapshot: SessionSnapshot;
}
export interface PollOpenedBody {
  pollId: string;
  question: string;
  options: string[];
  state: 'open';
}
export interface PollClosedBody {
  pollId: string;
  total: number;
  results: PollResult[];
}
export interface ChatMessage {
  messageId: string;
  author: string;
  text: string;
  sentAt: string;
}

// ---- after class ----

export interface AttendanceRow {
  learnerId: string;
  displayName: string;
  status: AttendanceStatus;
  firstJoined: string | null;
  lastLeft: string | null;
  visits: number;
}
export interface SummaryBody {
  attendance: { present: number; late: number; leftEarly: number; lateLeftEarly: number; absent: number };
  polls: { pollId: string; question: string; total: number; results: PollResult[] }[];
  handsTaken: number;
  breakoutRounds: number;
}
export interface ReviewBody {
  lessonTitle: string;
  slides: { fileId: string; number: number; url: string }[];
  models: { fileId: string; number: number; url: string }[];
}

// ---- WebSocket ----

export type LiveEvent =
  | 'snapshot' // sent on connect
  | 'state' // open, start, end
  | 'seat'
  | 'slide'
  | 'hand-raised' // + displayName
  | 'hand-lowered'
  | 'hand-taken' // + displayName
  | 'poll-opened'
  | 'poll-answered'
  | 'poll-closed'
  | 'spotlight' // + displayName (null when cleared)
  | 'lock'
  | 'breakouts-started'
  | 'breakouts-extended'
  | 'breakout-warning'
  | 'breakout-over'
  | 'chat' // + tableId, message (only for recipients allowed to read that table)
  | 'presence'
  | 'paused'
  | 'resumed';

export interface LiveMessage {
  event: LiveEvent;
  snapshot: SessionSnapshot;
  displayName?: string | null;
  tableId?: string;
  message?: ChatMessage;
}

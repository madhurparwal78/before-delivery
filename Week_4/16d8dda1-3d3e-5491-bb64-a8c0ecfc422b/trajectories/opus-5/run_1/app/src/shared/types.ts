export type SessionState = 'scheduled' | 'open' | 'live' | 'breakouts' | 'ended';
export type LessonState = 'draft' | 'uploading' | 'ready';
export type FileStatus = 'pending' | 'confirmed';
export type ClassRole = 'owner' | 'co-teacher';
export type ViewerRole = 'teacher' | 'co-teacher' | 'learner';
export type AttendanceStatus = 'present' | 'late' | 'left_early' | 'late_left_early' | 'absent';

export interface PieceJson {
  kind: string;
  column: number;
  row: number;
}

export interface LayoutJson {
  columns: number;
  rows: number;
  pieces: PieceJson[];
}

export interface SeatPlan {
  seatId: string;
  table: string | null;
  row: number;
  column: number;
}

export interface TablePlan {
  tableId: string;
  row: number;
  column: number;
}

export interface SnapshotSeat extends SeatPlan {
  learnerId: string | null;
  displayName: string | null;
  hand: 'raised' | 'down';
  breakoutTable: string | null;
}

export interface SnapshotHand {
  learnerId: string;
  displayName: string;
}

export interface SnapshotPoll {
  pollId: string;
  question: string;
  options: string[];
  state: 'open' | 'closed';
  counts: number[] | null;
  yourAnswer: number | null;
}

export interface SnapshotBreakoutTable {
  tableId: string;
  learnerIds: string[];
}

export interface SnapshotBreakout {
  tables: SnapshotBreakoutTable[];
  remainingSeconds: number;
  warning: boolean;
  /** The round's whole length, extensions included, which the floor rings drain over. */
  lengthSeconds: number;
}

export interface SessionSnapshot {
  id: string;
  classId: string;
  classTitle: string;
  lessonId: string;
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
  seats: SnapshotSeat[];
  tables: TablePlan[];
  hands: SnapshotHand[];
  poll: SnapshotPoll | null;
  breakout: SnapshotBreakout | null;
  you: { role: ViewerRole; learnerId: string | null };
  live: boolean;
}

export interface LessonFileJson {
  fileId: string;
  name: string;
  number: number;
  bytes: number;
  status: FileStatus;
}

export interface LessonJson {
  id: string;
  classId: string;
  title: string;
  state: LessonState;
  slides: LessonFileJson[];
  models: LessonFileJson[];
}

export interface ClassListItem {
  id: string;
  title: string;
  timeZone: string;
  code: string;
  role: ClassRole;
}

export interface ClassDetail {
  id: string;
  title: string;
  timeZone: string;
  code: string;
  role: ClassRole;
  layout: LayoutJson;
  seats: SeatPlan[];
  tables: TablePlan[];
  coTeachers: { id: string; displayName: string; email: string }[];
  lessons: { id: string; title: string; state: LessonState }[];
  sessions: { id: string; lessonId: string; state: SessionState; startsAt: string; endsAt: string }[];
}

export interface PollResultJson {
  option: string;
  count: number;
  percent: number;
}

export interface AttendanceRow {
  learnerId: string;
  displayName: string;
  status: AttendanceStatus;
  firstJoined: string | null;
  lastLeft: string | null;
  visits: number;
}

export interface SummaryJson {
  attendance: { present: number; late: number; leftEarly: number; lateLeftEarly: number; absent: number };
  polls: { pollId: string; question: string; total: number; results: PollResultJson[] }[];
  handsTaken: number;
  breakoutRounds: number;
}

export interface ReviewJson {
  lessonTitle: string;
  slides: { fileId: string; number: number; url: string }[];
  models: { fileId: string; number: number; url: string }[];
}

export interface ChatMessageJson {
  messageId: string;
  author: string;
  text: string;
  sentAt: string;
}

export type LiveEvent =
  | 'snapshot'
  | 'seat'
  | 'slide'
  | 'hand'
  | 'hand-taken'
  | 'poll-opened'
  | 'poll-answer'
  | 'poll-closed'
  | 'spotlight'
  | 'lock'
  | 'breakouts-started'
  | 'breakouts-extended'
  | 'breakout-warning'
  | 'breakouts-ended'
  | 'chat'
  | 'presence'
  | 'session-state'
  | 'clock'
  | 'live-paused'
  | 'live-resumed';

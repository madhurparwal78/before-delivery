export interface SlideSnapshot {
  fileId: string
  number: number
  url: string
}

export interface ReviewBody {
  lessonTitle: string
  slides: SlideSnapshot[]
  models: SlideSnapshot[]
}

export interface SeatSnapshot {
  seatId: string
  table: string | null
  row: number
  column: number
  learnerId: string | null
  displayName: string | null
  hand: 'up' | 'down'
  breakoutTable: string | null
}

export interface TableSnapshot {
  tableId: string
  row: number
  column: number
}

export interface HandSnapshot {
  learnerId: string
  displayName: string
}

export interface PollSnapshot {
  pollId: string
  question: string
  options: string[]
  state: 'open' | 'closed'
  counts: number[] | null
  yourAnswer: number | null
  results?: { option: string; count: number; percent: number }[]
}

export interface BreakoutSnapshot {
  tables: { tableId: string; learnerIds: string[] }[]
  remainingSeconds: number
  warning: boolean
}

export interface SessionSnapshot {
  id: string
  classId: string
  lessonId: string
  state: 'scheduled' | 'open' | 'live' | 'breakouts' | 'ended'
  title: string
  timeZone: string
  startsAt: string
  endsAt: string
  startsAtUtc: string
  endsAtUtc: string
  slide: { current: number; total: number; fileId: string | null }
  modelFileId: string | null
  locked: boolean
  spotlight: { learnerId: string; displayName: string } | null
  seats: SeatSnapshot[]
  tables: TableSnapshot[]
  hands: HandSnapshot[]
  poll: PollSnapshot | null
  breakout: BreakoutSnapshot | null
  you: { role: 'teacher' | 'co-teacher' | 'learner'; learnerId: string | null; displayName: string }
  live: boolean
}

export interface Announcement {
  text: string
}

export interface TeacherInfo {
  role: 'teacher'
  id: string
  email: string
  displayName: string
}

export interface LearnerInfo {
  role: 'learner'
  id: string
  displayName: string
}

export interface LessonFile {
  fileId: string
  name: string
  number: number
  bytes: number
  status: 'pending' | 'confirmed'
}

export interface LessonBody {
  id: string
  classId: string
  title: string
  state: 'draft' | 'uploading' | 'ready'
  slides: LessonFile[]
  models: LessonFile[]
}

export interface ClassBody {
  id: string
  title: string
  timeZone: string
  code: string
  layout: import('./rules.js').Layout
  seats?: import('./rules.js').SeatInfo[]
  tables?: import('./rules.js').TableInfo[]
  coTeachers?: { id: string; displayName: string; email: string }[]
  lessons?: { id: string; title: string; state: string }[]
  sessions?: { id: string; lessonId: string; state: string; startsAt: string; endsAt: string }[]
}

export interface ClassSummaryRow {
  id: string
  title: string
  timeZone: string
  code: string
  role: 'owner' | 'co-teacher'
}

export interface AttendanceRow {
  learnerId: string
  displayName: string
  status: 'present' | 'late' | 'left_early' | 'late_left_early' | 'absent'
  firstJoined: string | null
  lastLeft: string | null
  visits: number
}

export interface SummaryBody {
  attendance: { present: number; late: number; leftEarly: number; lateLeftEarly: number; absent: number }
  polls: { pollId: string; question: string; total: number; results: { option: string; count: number; percent: number }[] }[]
  handsTaken: number
  breakoutRounds: number
}

export interface ChatMessage {
  messageId: string
  author: string
  text: string
  sentAt: string
}

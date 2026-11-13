// Shapes that cross the wire between the server and the editor.

import type { Clef, TimeSignature, Transpose } from './music.js'
import type { Operation, PlacedEvent } from './voice.js'

export type Role = 'composer' | 'copyist' | 'player'
export type CollaboratorStatus = 'invited' | 'active' | 'removed'

export const ROLE_WORD: Record<Role, string> = { composer: 'Composer', copyist: 'Copyist', player: 'Section player' }
export const STATUS_WORD: Record<CollaboratorStatus, string> = { invited: 'Invited', active: 'Active', removed: 'Removed' }

export interface Collaborator {
  id: string
  name: string
  role: Role
  status: CollaboratorStatus
  staffIds: string[]
}

export interface Staff {
  id: string
  name: string
  clef: Clef
  transpose: Transpose
  partId: string
  order: number
}

export interface PartRef {
  id: string
  name: string
  staffIds: string[]
}

export interface ScoreSummary {
  id: string
  title: string
  measureCount: number
  timeSignatures: TimeSignature[]
  tempos: { measure: number; bpm: number }[]
  staves: Staff[]
  parts: PartRef[]
  lamport: number
  lastSeq: number
}

export type PartStatus = 'draft' | 'engraving' | 'rendering' | 'ready' | 'pdf_pending'
type PartError = 'storage_unavailable' | 'renderer_unavailable'

export interface PartLayout {
  systemBreaks: number[]
  pageBreaks: number[]
}

export interface Part {
  id: string
  name: string
  staffIds: string[]
  status: PartStatus
  revision: number
  extractedAtLamport: number | null
  stale: boolean
  pageCount: number | null
  layout: PartLayout
  lastError: PartError | null
}

export interface Author {
  id: string
  name: string
  role: Role
}

export interface LogEntry {
  seq: number
  op: Operation
  author: Author
}

export interface HistoryEntry {
  seq: number
  opId: string
  type: 'insert' | 'delete' | 'set'
  field: string | null
  staffId: string
  staffName: string
  voice: number
  measure: number
  beat: number
  author: Author
  at: string
  summary: string
}

export interface PresenceCursor {
  staffId: string
  measure: number
  beat: number
}

export interface PresenceEntry {
  collaboratorId: string
  name: string
  role: Role
  cursor: PresenceCursor | null
}

export interface Hold {
  staffId: string
  holder: Author
  since: string
}

export interface Bank {
  id: string
  fileName: string
  kind: 'wav' | 'sfz'
  bytes: number
  staffId: string
  rootPitch: string | null
  status: 'loaded'
  createdAt: string
}

export interface SystemSvg {
  index: number
  page: number
  firstMeasure: number
  lastMeasure: number
  svg: string
}

export interface EngravingPage {
  view: 'score' | 'part'
  partId: string | null
  lamport: number
  systems: SystemSvg[]
  nextCursor: string | null
}

export interface VoiceResponse {
  staffId: string
  voice: number
  events: PlacedEvent[]
}

export interface ApiErrorBody {
  error: string
  message: string
  errors?: Record<string, string>
  heldBy?: Author
  staffIds?: string[]
  retryAfterSeconds?: number
  status?: string
}

export type ServerMessage =
  | { type: 'welcome'; connectionId: string; lamport: number; lastSeq: number; live: boolean }
  | { type: 'ops'; entries: LogEntry[] }
  | { type: 'presence'; entries: PresenceEntry[] }
  | { type: 'holds'; holds: Hold[] }
  | { type: 'part'; part: Part }
  | { type: 'bank'; bank: Bank }
  | { type: 'score'; score: ScoreSummary }
  | { type: 'collaborators'; collaborators: Collaborator[] }
  | { type: 'live'; live: boolean }
  | { type: 'removed' }

export interface ClientHeartbeat {
  type: 'heartbeat'
  cursor: PresenceCursor | null
  seen?: number
}

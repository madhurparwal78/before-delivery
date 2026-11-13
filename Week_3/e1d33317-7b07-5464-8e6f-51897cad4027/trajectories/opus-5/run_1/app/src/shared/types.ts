export type Role = 'composer' | 'copyist' | 'player';
export type CollaboratorStatus = 'invited' | 'active' | 'removed';
export type Clef = 'treble' | 'alto' | 'tenor' | 'bass' | 'percussion';
export type DurationName = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd';
export type SetField =
  | 'pitch'
  | 'duration'
  | 'dots'
  | 'tie'
  | 'dynamic'
  | 'dynamicPlacement'
  | 'text';
export type DynamicMark = 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'sfz' | 'fp';
export type DynamicPlacement = 'above' | 'below';
export type PartStatus = 'draft' | 'engraving' | 'rendering' | 'ready' | 'pdf_pending';
export type PartError = 'storage_unavailable' | 'renderer_unavailable';
export type Voice = 1 | 2;

export interface ElementId {
  lamport: number;
  site: string;
}

export interface Pitch {
  step: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  alter: number;
  octave: number;
}

export interface Transpose {
  diatonic: number;
  chromatic: number;
}

export interface Staff {
  id: string;
  name: string;
  clef: Clef;
  transpose: Transpose;
  partId: string;
  order: number;
}

export interface PartSummary {
  id: string;
  name: string;
  staffIds: string[];
}

export interface TimeSignature {
  measure: number;
  beats: number;
  beatType: number;
}

export interface TempoMark {
  measure: number;
  bpm: number;
}

export interface ScoreHead {
  id: string;
  title: string;
  measureCount: number;
  timeSignatures: TimeSignature[];
  tempos: TempoMark[];
  staves: Staff[];
  parts: PartSummary[];
  lamport: number;
  lastSeq: number;
}

export interface Collaborator {
  id: string;
  name: string;
  role: Role;
  status: CollaboratorStatus;
  staffIds: string[];
}

export interface PartLayout {
  systemBreaks: number[];
  pageBreaks: number[];
}

export interface Part {
  id: string;
  name: string;
  staffIds: string[];
  status: PartStatus;
  revision: number;
  extractedAtLamport: number | null;
  stale: boolean;
  pageCount: number | null;
  layout: PartLayout;
  lastError: PartError | null;
}

export interface SampleBank {
  id: string;
  fileName: string;
  kind: 'wav' | 'sfz';
  bytes: number;
  staffId: string;
  rootPitch: string | null;
  status: 'loaded';
  createdAt: string;
}

export interface EventPiece {
  measure: number;
  beat: number;
  ticks: number;
}

export interface VoiceEvent {
  id: ElementId;
  kind: 'note' | 'rest';
  pitch: Pitch | null;
  duration: DurationName;
  dots: number;
  ticks: number;
  tie: boolean;
  dynamic: DynamicMark | null;
  dynamicPlacement: DynamicPlacement | null;
  text: string;
  measure: number;
  beat: number;
  pieces: EventPiece[];
}

export interface InsertOp {
  id: ElementId;
  type: 'insert';
  staffId: string;
  voice: Voice;
  after: ElementId | null;
  event: {
    kind: 'note' | 'rest';
    pitch?: Pitch;
    duration: DurationName;
    dots: number;
  };
}

export interface DeleteOp {
  id: ElementId;
  type: 'delete';
  staffId: string;
  voice: Voice;
  target: ElementId;
}

export interface SetOp {
  id: ElementId;
  type: 'set';
  staffId: string;
  voice: Voice;
  target: ElementId;
  field: SetField;
  value: unknown;
}

export type Operation = InsertOp | DeleteOp | SetOp;

export interface OpLogEntry {
  seq: number;
  op: Operation;
  author: { id: string; name: string; role: Role };
}

export interface HistoryEntry {
  seq: number;
  opId: ElementId;
  type: Operation['type'];
  field: SetField | null;
  staffId: string;
  staffName: string;
  voice: Voice;
  measure: number;
  beat: number;
  author: { id: string; name: string; role: Role };
  at: string;
  summary: string;
}

export interface Hold {
  staffId: string;
  holder: { id: string; name: string; role: Role };
  since: string;
}

export interface PresenceCursor {
  staffId: string;
  measure: number;
  beat: number;
}

export interface PresenceEntry {
  collaboratorId: string;
  name: string;
  role: Role;
  cursor: PresenceCursor | null;
}

export interface EngravedSystem {
  index: number;
  page: number;
  firstMeasure: number;
  lastMeasure: number;
  svg: string;
}

export interface EngravingResponse {
  view: 'score' | 'part';
  partId: string | null;
  lamport: number;
  systems: EngravedSystem[];
  nextCursor: string | null;
}

export type ServerMessage =
  | { type: 'welcome'; connectionId: string; lamport: number; lastSeq: number; live: boolean }
  | { type: 'ops'; entries: OpLogEntry[] }
  | { type: 'presence'; entries: PresenceEntry[] }
  | { type: 'holds'; holds: Hold[] }
  | { type: 'part'; part: Part }
  | { type: 'bank'; bank: SampleBank }
  | { type: 'score'; score: ScoreHead }
  | { type: 'live'; live: boolean }
  | { type: 'removed' };

export interface HeartbeatMessage {
  type: 'heartbeat';
  cursor: PresenceCursor | null;
  seen: number;
}

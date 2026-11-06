// The API's published shapes, as the browser reads them.

import type { Language } from '../shared/copy';
import type { Town } from '../shared/time';
import type { FrameRate } from '../shared/timecode';

export interface Client {
  id: string;
  name: string;
  place: keyof typeof import('../shared/copy').LABELS.place;
  state: keyof typeof import('../shared/copy').LABELS.clientState;
  closesAt: string | null;
  createdAt: string;
}

export interface ClientList {
  clients: Client[];
  total: number;
  erasedClients: { id: string; name: string; erasedAt: string }[];
}

export interface Producer {
  id: string;
  clientId: string;
  name: string;
  email: string;
  town: Town;
  language: Language;
}

export interface Job {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  adId: string;
  dueDate: string;
  targetSeconds: number;
  frameRate: FrameRate;
  aspect: string;
  state: keyof typeof import('../shared/copy').LABELS.jobState;
  createdAt: string;
}

export interface JobPage {
  jobs: Job[];
  total: number;
  nextCursor: string | null;
}

export interface Frame {
  number: number;
  position: number;
  durationFrames: number;
  actionNote: string;
  audioNote: string;
  shot: string;
  visual: string;
  fileName: string | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  drawingUrl: string | null;
}

export interface Board {
  jobId: string;
  stamp: string;
  frameRate: FrameRate;
  targetSeconds: number;
  targetFrames: number;
  totalFrames: number;
  secondsText: string;
  targetText: string;
  frames: Frame[];
  playhead?: number;
}

export interface Removal {
  frame: number;
  position: number;
  endsAt: string;
}

export interface Line {
  id: string;
  frame: number;
  market: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  clips: number;
}

export interface Track {
  id: string;
  title: string;
  composer: string;
  seconds: number;
}

export interface Cue {
  id: string;
  trackId: string;
  title: string;
  composer: string;
  seconds: number;
  market: string;
  from: string;
  until: string;
  fee: string;
  licenceId: string;
  licenceText: string;
}

export interface Cut {
  id: string;
  number: number;
  name: string;
  frameRate: FrameRate;
  createdAt: string;
  signedOffAt: string | null;
  signedOffBy: string | null;
  frames?: Frame[];
}

export interface Render {
  id: string;
  cut: number;
  width: number;
  burnTimecode: boolean;
  state: 'queued' | 'running' | 'done' | 'failed' | 'ready' | 'outdated';
  progress: number;
  message: string | null;
  size: number | null;
  sha256: string | null;
  filmUrl: string | null;
  createdAt: string;
}

export interface PrivatePageRow {
  id: string;
  producerId: string;
  cut: number;
  url: string;
  state: 'open' | 'ended';
  endsAt: string;
}

export interface HistoryEvent {
  at: string;
  actor: string;
  action: string;
  text: string;
}

export interface Note {
  id: string;
  frame: number;
  position: number | null;
  goneText: string | null;
  timecode: string;
  x: number;
  y: number;
  producerId: string;
  producerName: string;
  typedName: string;
  state: keyof typeof import('../shared/copy').LABELS.noteState;
  text: string;
  suggestedSeconds: string | null;
  suggestedFrames: number | null;
  attachmentUrl: string | null;
  createdAt: string;
}

export interface Call {
  id: string;
  producerId: string;
  producerName: string;
  town: Town;
  date: string;
  time: string;
  minutes: number;
  note: string;
  startsAt: string;
  endsAt: string;
  text: string;
  uid: string;
  sequence: number;
  state: 'booked' | 'cancelled';
}

export interface PackageRow {
  id: string;
  cut: number;
  state: 'making' | 'ready';
  files: { kind: 'boards' | 'editDecisionList' | 'shotList'; fileName: string; size: number; sha256: string; url: string }[];
  createdAt: string;
}

export interface MilestoneRow {
  number: number;
  amountMinor: number;
  taxMinor: number;
  amountText: string;
  taxText: string;
}

export interface Letter {
  id: string;
  jobId: string;
  currency: string;
  scope: string;
  feeMinor: number;
  taxMinor: number;
  totalMinor: number;
  feeText: string;
  taxText: string;
  totalText: string;
  milestones: MilestoneRow[];
  state: 'draft' | 'sent' | 'accepted';
  stamp: string;
  producerId: string | null;
  pageUrl: string | null;
  endsAt: string | null;
  pdfUrl: string;
}

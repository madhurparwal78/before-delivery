export type EventStatus =
  | 'draft'
  | 'registration_open'
  | 'registration_closed'
  | 'running'
  | 'provisional'
  | 'final'
  | 'published';

export type StandingsView = 'indexed' | 'class' | 'raw';

export type RunStatus = 'pending' | 'committed' | 'corrected' | 'rerun_granted';
export type RunOutcome = 'time' | 'dnf' | 'rerun';

export type ClubRole = 'chair' | 'timing' | 'workers';

export interface ClubSummary {
  slug: string;
  name: string;
  timeZone: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  club: ClubSummary | null;
}

export interface HeatSpec {
  number: number;
  classes: string[];
}

export interface EventDto {
  id: string;
  name: string;
  date: string;
  venue: string;
  timeZone: string;
  registrationCutoff: string;
  registrationCutoffUtc: string;
  runsPerDriver: number;
  heats: HeatSpec[];
  stations: string[];
  status: EventStatus;
  registrationOpen: boolean;
  runningHeat: number | null;
  provisionalAt: string | null;
  protestWindowClosesAt: string | null;
  protestWindowOpen: boolean;
  indexTable: { id: string; effectiveDate: string };
  factors: Record<string, string>;
  version: number;
  publishedAt: string | null;
  resultsChecksum: string | null;
  serverTime: string;
}

export interface RunDto {
  id: string;
  runNumber: number;
  status: RunStatus;
  outcome: RunOutcome | null;
  rawTime: string | null;
  cones: number | null;
  adjustedTime: string | null;
  indexedTime: string | null;
  factor: string | null;
  committedAt: string | null;
  committedBy: { id: string; name: string } | null;
}

export interface RegistrationDto {
  id: string;
  eventId: string;
  driver: { id: string; name: string };
  classCode: string;
  carNumber: number;
  carDescription: string;
  runHeat: number;
  checkedIn: boolean;
  checkedInAt: string | null;
  waiver: { key: string; checksum: string } | null;
  station: { id: string; name: string; heat: number } | null;
  confirmationEmail: 'sent' | 'pending';
}

export interface RankChange {
  indexed: string;
  class: string;
  raw: string;
}

export interface StandingsRow {
  registrationId: string;
  carNumber: number;
  classCode: string;
  driverName: string;
  carDescription: string;
  position: number | null;
  classPosition: number | null;
  rawPosition: number | null;
  bestAdjusted: string | null;
  bestIndexed: string | null;
  lastChange: { runNumber: number; at: string; rankChange: RankChange } | null;
  runs: RunDto[];
}

export interface StandingsResponse {
  eventId: string;
  status: EventStatus;
  runningHeat: number | null;
  view: StandingsView;
  updatedAt: string;
  rows: StandingsRow[];
}

export interface RotaStation {
  id: string;
  name: string;
  worker: {
    registrationId: string;
    driverName: string;
    carNumber: number;
    classCode: string;
  } | null;
}

export interface RotaHeat {
  number: number;
  unfilled: number;
  stations: RotaStation[];
}

export interface RunGridEntry {
  registrationId: string;
  carNumber: number;
  classCode: string;
  driverName: string;
  runHeat: number;
  checkedIn: boolean;
  runs: RunDto[];
}

export interface CommitResultEntry {
  registrationId: string;
  carNumber: number;
  classCode: string;
  position: number | null;
  classPosition: number | null;
  rawPosition: number | null;
  bestAdjusted: string | null;
  bestIndexed: string | null;
}

export interface CommitResponse {
  run: RunDto;
  entry: CommitResultEntry;
  rankChange: RankChange;
}

export interface CorrectionValues {
  outcome: 'time' | 'dnf';
  rawTime: string | null;
  cones: number | null;
  adjustedTime: string | null;
  indexedTime: string | null;
}

export interface CorrectionDto {
  id: string;
  runId: string;
  registrationId: string;
  carNumber: number;
  classCode: string;
  runNumber: number;
  actor: { id: string; name: string };
  at: string;
  reason: string;
  before: CorrectionValues;
  after: CorrectionValues;
}

export interface ProtestDto {
  id: string;
  filedBy: { id: string; name: string };
  subject: {
    registrationId: string;
    carNumber: number;
    classCode: string;
    driverName: string;
  };
  text: string;
  filedAt: string;
  status: 'pending' | 'upheld' | 'denied';
  decisionNote: string | null;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
}

export interface PublicationDto {
  status: EventStatus;
  renderer: 'ok' | 'unavailable';
  publishedAt: string | null;
  pdfKey: string | null;
  checksum: string | null;
  emailsAccepted: number;
  emailsTotal: number;
}

export interface IndexTableDto {
  id: string;
  effectiveDate: string;
  factors: Record<string, string>;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

export interface SeasonRow {
  position: number;
  driverId: string;
  driverName: string;
  carDescription: string;
  classCode: string;
  events: number;
  points: string;
}

export interface SeasonResponse {
  year: number;
  events: { id: string; name: string; date: string }[];
  rows: SeasonRow[];
}

export interface OperatorClubRow {
  slug: string;
  name: string;
  timeZone: string;
  eventCount: number;
  driverCount: number;
  publishedCount: number;
  lastDeliveryFailure: {
    service: 'renderer' | 'storage' | 'mail';
    eventId: string | null;
    at: string;
  } | null;
}

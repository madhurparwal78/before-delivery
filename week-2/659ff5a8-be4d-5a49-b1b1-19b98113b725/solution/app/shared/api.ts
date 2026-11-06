/** The shapes the API returns, shared by the server that builds them and the screens that read them. */
import type { EventStatus, RunOutcome, RunStatus } from "./lifecycle.js";

export type Role = "operator" | "chair" | "timing" | "workers";
export type View = "indexed" | "class" | "raw";

interface ClubSummary {
  slug: string;
  name: string;
  timeZone: string;
}

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  roles: Role[];
  club: ClubSummary | null;
}

export interface Heat {
  number: number;
  classes: string[];
}

export interface EventView {
  id: number;
  name: string;
  date: string;
  venue: string;
  timeZone: string;
  registrationCutoff: string;
  registrationCutoffUtc: string;
  runsPerDriver: number;
  heats: Heat[];
  stations: string[];
  status: EventStatus;
  registrationOpen: boolean;
  runningHeat: number | null;
  provisionalAt: string | null;
  protestWindowClosesAt: string | null;
  protestWindowOpen: boolean;
  indexTable: { id: number; effectiveDate: string };
  factors: Record<string, string>;
  version: number;
  publishedAt: string | null;
  resultsChecksum: string | null;
  serverTime: string;
}

export interface RunView {
  id: number;
  runNumber: number;
  status: RunStatus;
  outcome: RunOutcome | null;
  rawTime: string | null;
  cones: number | null;
  adjustedTime: string | null;
  indexedTime: string | null;
  factor: string | null;
  committedAt: string | null;
  committedBy: { id: number; name: string } | null;
}

interface StationRef {
  id: number;
  name: string;
  heat: number;
}

export interface RegistrationView {
  id: number;
  eventId: number;
  driver: { id: number; name: string };
  classCode: string;
  carNumber: number;
  carDescription: string;
  runHeat: number;
  checkedIn: boolean;
  checkedInAt: string | null;
  waiver: { key: string; checksum: string } | null;
  station: StationRef | null;
  confirmationEmail: "sent" | "pending";
}

export interface RotaStation {
  id: number;
  name: string;
  worker: { registrationId: number; driverName: string; carNumber: number; classCode: string } | null;
}

export interface RotaHeat {
  number: number;
  unfilled: number;
  stations: RotaStation[];
}

export interface RunEntry {
  registrationId: number;
  carNumber: number;
  classCode: string;
  driverName: string;
  runHeat: number;
  checkedIn: boolean;
  runs: RunView[];
}

export interface RankChange {
  indexed: string;
  class: string;
  raw: string;
}

export interface EntryStanding {
  registrationId: number;
  carNumber: number;
  classCode: string;
  position: number | null;
  classPosition: number | null;
  rawPosition: number | null;
  bestAdjusted: string | null;
  bestIndexed: string | null;
}

export interface CommitResult {
  run: RunView;
  entry: EntryStanding;
  rankChange: RankChange;
}

export interface CorrectionEntry {
  id: number;
  runId: number;
  registrationId: number;
  carNumber: number;
  classCode: string;
  runNumber: number;
  actor: { id: number; name: string };
  at: string;
  reason: string;
  before: CorrectionValues;
  after: CorrectionValues;
}

export interface CorrectionValues {
  outcome: RunOutcome;
  rawTime: string | null;
  cones: number | null;
  adjustedTime: string | null;
  indexedTime: string | null;
}

export interface StandingRow extends EntryStanding {
  driverName: string;
  carDescription: string;
  lastChange: { runNumber: number; at: string; rankChange: RankChange } | null;
  runs: RunView[];
}

export interface Standings {
  eventId: number;
  status: EventStatus;
  runningHeat: number | null;
  view: View;
  updatedAt: string;
  rows: StandingRow[];
}

export interface Protest {
  id: number;
  filedBy: { id: number; name: string };
  subject: { registrationId: number; carNumber: number; classCode: string; driverName: string };
  text: string;
  filedAt: string;
  status: "pending" | "upheld" | "denied";
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface Publication {
  status: EventStatus;
  renderer: "ok" | "unavailable";
  publishedAt: string | null;
  pdfKey: string | null;
  checksum: string | null;
  emailsAccepted: number;
  emailsTotal: number;
}

export interface IndexTableView {
  id: number;
  effectiveDate: string;
  factors: Record<string, string>;
  createdAt: string;
  createdBy: { id: number; name: string } | null;
}

export interface SeasonRow {
  position: number;
  driverId: number;
  driverName: string;
  carDescription: string;
  classCode: string;
  events: number;
  points: string;
}

export interface Season {
  year: number;
  events: { id: number; name: string; date: string }[];
  rows: SeasonRow[];
}

export interface OperatorClub {
  slug: string;
  name: string;
  timeZone: string;
  eventCount: number;
  driverCount: number;
  publishedCount: number;
  lastDeliveryFailure: { service: "renderer" | "storage" | "mail"; eventId: number | null; at: string } | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

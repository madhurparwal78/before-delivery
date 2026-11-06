// API client: one fetch wrapper with the published error shape.

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export class ApiFail extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

export interface User {
  id: string;
  name: string;
  email: string;
  roles: string[];
  club: { slug: string; name: string; timeZone: string } | null;
}

export interface EventHeats {
  number: number;
  classes: string[];
}

export interface EventObj {
  id: string;
  name: string;
  date: string;
  venue: string;
  timeZone: string;
  registrationCutoff: string;
  registrationCutoffUtc: string;
  runsPerDriver: number;
  heats: EventHeats[];
  stations: string[];
  status: string;
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

export interface RegistrationObj {
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
  confirmationEmail: "sent" | "pending";
}

export interface RunObj {
  id: string;
  runNumber: number;
  status: "pending" | "committed" | "corrected" | "rerun_granted";
  outcome: "time" | "dnf" | "rerun" | null;
  rawTime: string | null;
  cones: number | null;
  adjustedTime: string | null;
  indexedTime: string | null;
  factor: string | null;
  committedAt: string | null;
  committedBy: { id: string; name: string } | null;
}

export interface StandingsRowObj {
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
  lastChange: { runNumber: number; at: string; rankChange: { indexed: string; class: string; raw: string } } | null;
  runs: RunObj[];
}

export interface EntryObj {
  registrationId: string;
  carNumber: number;
  classCode: string;
  driverName: string;
  runHeat: number;
  checkedIn: boolean;
  runs: RunObj[];
}

export interface RotaHeat {
  number: number;
  unfilled: number;
  stations: { id: string; name: string; worker: { registrationId: string; driverName: string; carNumber: number; classCode: string } | null }[];
}

export interface CorrectionObj {
  id: string;
  runId: string;
  registrationId: string;
  carNumber: number;
  classCode: string;
  runNumber: number;
  actor: { id: string; name: string };
  at: string;
  reason: string;
  before: { outcome: string | null; rawTime: string | null; cones: number | null; adjustedTime: string | null; indexedTime: string | null };
  after: { outcome: string | null; rawTime: string | null; cones: number | null; adjustedTime: string | null; indexedTime: string | null };
}

export interface ProtestObj {
  id: string;
  filedBy: { id: string; name: string };
  subject: { registrationId: string; carNumber: number; classCode: string; driverName: string };
  text: string;
  filedAt: string;
  status: "pending" | "upheld" | "denied";
  decisionNote: string | null;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
}

export interface PublicationObj {
  status: string;
  renderer: "ok" | "unavailable";
  publishedAt: string | null;
  pdfKey: string | null;
  checksum: string | null;
  emailsAccepted: number;
  emailsTotal: number;
}

export interface IndexTableObj {
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

export interface ClubRow {
  slug: string;
  name: string;
  timeZone: string;
  eventCount: number;
  driverCount: number;
  publishedCount: number;
  lastDeliveryFailure: { service: string; eventId: string | null; at: string } | null;
}

async function request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiFail(res.status, data as ApiErrorBody);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>("POST", path, body, headers),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

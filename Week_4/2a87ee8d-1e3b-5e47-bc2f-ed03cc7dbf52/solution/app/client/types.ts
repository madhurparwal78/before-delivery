// The API's response shapes, as the client reads them.
import type { Status } from "../shared/states.js";
import type { Plan, Term } from "../shared/plans.js";
import type { RecapReason, VersionReason } from "../shared/copy.js";
import type { Template } from "../shared/templates.js";

export interface Invoice {
  id: string;
  number: string;
  date: string;
  amount: string;
  balance: string;
  currency: "EUR";
  status: "paid" | "unpaid";
}

export interface Billing {
  plan: Plan;
  term: Term;
  state: "active" | "past_due" | "read_only";
  pastDueSince: string | null;
  readOnlyAt: string | null;
  renewsOn: string;
  pendingChange: { plan: Plan; term: Term; effectiveDate: string } | null;
  entitlements: { activeWorkshops: number | null; invitesPerDay: number };
  usage: { activeWorkshops: number; invitesToday: number };
  invoices: Invoice[];
  stale: boolean;
  syncedAt: string | null;
}

export interface Facilitator {
  name: string;
  email: string;
  timeZone: string;
}

export interface Recap {
  status: "queued" | "complete";
  reason: RecapReason | null;
  attempts: number;
  recipients: number;
  recapUrl: string;
  invoice: { id: string; number: string; amount: string; currency: "EUR" } | null;
}

export interface Round {
  number: number;
  endsAt: string;
}

export interface Voting {
  dotBudget: number;
  endsAt: string;
}

export interface FacilitatorWorkshop {
  id: string;
  title: string;
  template: Template;
  status: Status;
  scheduledStart: string;
  scheduledEnd: string;
  timeZone: string;
  sponsorEmail: string;
  fee: { amount: string; currency: "EUR" };
  invites: { email: string; status: "sent" | "queued" }[];
  joinUrl: string | null;
  joinLinkExpiresAt: string;
  participantCount: number;
  participantCap: number | null;
  roundsUsed: number;
  round: Round | null;
  voting: Voting | null;
  version: number;
  recap: Recap | null;
}

export interface ParticipantWorkshop {
  id: string;
  title: string;
  status: Status;
  round: Round | null;
  voting: Voting | null;
  version: number;
}

export interface Frame {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  position: number;
  noteCount: number;
  hiddenCount: number;
}

export interface Cluster {
  id: string;
  frameId: string;
  title: string;
  x: number;
  y: number;
  noteIds: string[];
  noteCount: number;
  dotTotal?: number;
  myDots?: number;
}

export interface Note {
  id: string;
  frameId: string;
  clusterId?: string | null;
  kind?: "text" | "image";
  text?: string | null;
  imageUrl?: string | null;
  x: number;
  y: number;
  revealed: boolean;
  mine: boolean;
  authorName?: string;
  facilitatorOnly?: boolean;
}

export interface Connector {
  id: string;
  fromNoteId: string;
  toNoteId: string;
}

export interface Participant {
  id: string;
  displayName: string;
  notesThisRound: number;
  active: boolean;
}

export type Viewer =
  | { role: "facilitator"; name: string }
  | { role: "participant"; participantId: string; displayName: string; dotsRemaining: number | null };

export interface Board {
  serverTime: string;
  workshop: FacilitatorWorkshop | ParticipantWorkshop;
  viewer: Viewer;
  frames: Frame[];
  clusters: Cluster[];
  notes: Note[];
  connectors: Connector[];
  participants?: Participant[];
}

export interface TrashItem {
  id: string;
  kind: "frame";
  title: string;
  deletedAt: string;
  purgeAt: string;
  noteCount: number;
}

export interface Version {
  id: string;
  version: number;
  reason: VersionReason;
  createdAt: string;
  noteCount: number;
}

export interface Presence {
  cursorId: string;
  hue: number;
  x: number;
  y: number;
  name?: string;
}

export function isFacilitatorWorkshop(w: FacilitatorWorkshop | ParticipantWorkshop): w is FacilitatorWorkshop {
  return "joinUrl" in w;
}

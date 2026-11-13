// The published response shapes, shared by the server's views and the client's screens.
import type { Category, Condition, ConsignorStatus, PieceStatus, Role } from "./catalog";

export type StationKey = "full_price" | "off_25" | "off_50" | "period_ends";
type StationState = "done" | "current" | "next";
export type Choice = "return" | "donate";
export type Payment = "card" | "cash";

export interface Station {
  station: StationKey;
  label: string;
  at: string;
  priceCents: number | null;
  state: StationState;
}

export interface RailPiece {
  id: string;
  tagCode: string;
  description: string;
  category: Category;
  brand: string;
  size: string;
  condition: Condition;
  status: PieceStatus;
  station: StationKey;
  currentPriceCents: number;
  previousPriceCents: number | null;
  photoUrls: string[];
}

export interface PublicPiece extends RailPiece {
  stations: Station[];
  soldAt?: string;
}

export interface Photo {
  id: string;
  pieceId: string;
  contentType: string;
  width: number;
  height: number;
  publicUrl: string;
  createdAt: string;
}

export interface Piece extends RailPiece {
  consignor: { id: string; name: string };
  askingPriceCents: number;
  intakeDate: string;
  ladderId: string;
  stations: Station[];
  choice: Choice | null;
  choiceOpensAt: string;
  choiceClosesAt: string;
  photos: Photo[];
  version: number;
  archivedAt: string | null;
  collectedAt: string | null;
}

export interface PortalPiece {
  id: string;
  tagCode: string;
  description: string;
  category: Category;
  brand: string;
  size: string;
  status: PieceStatus;
  station: StationKey;
  currentPriceCents: number | null;
  previousPriceCents: number | null;
  stations: Station[];
  choice: Choice | null;
  choiceOpen: boolean;
  choiceOpensAt: string;
  choiceClosesAt: string;
  shareCents: number | null;
}

export interface Portal {
  consignor: { name: string; ibanLast4: string | null; ibanValid: boolean };
  pageEndsAt: string;
  pieces: PortalPiece[];
  earnings: { month: string; shareCents: number }[];
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface SessionBody {
  member: Pick<Member, "id" | "name" | "email" | "role">;
  homeRoute: string;
}

export interface Ladder {
  id: string;
  effectiveOn: string;
  firstMarkdownPercent: number;
  firstMarkdownDay: number;
  secondMarkdownPercent: number;
  secondMarkdownDay: number;
  periodEndDay: number;
}

export interface Hold {
  id: string;
  pieceId: string;
  tagCode: string;
  shopperName: string;
  shopperEmail: string;
  startsAt: string;
  endsAt: string;
  status: HoldStatus;
}

export type HoldStatus = "active" | "released" | "ended";

export interface HoldPage {
  status: HoldStatus;
  endsAt: string;
  secondsLeft: number;
  piece: { tagCode: string; description: string; category: Category; brand: string; size: string; currentPriceCents: number; photoUrl: string | null };
  shopAddress: string;
}

export interface Sale {
  id: string;
  pieceId: string;
  tagCode: string;
  soldAt: string;
  priceCents: number;
  consignorShareCents: number;
  commissionCents: number;
  vatCents: number;
  payment: Payment;
  soldBy: { id: string; name: string };
  consignorName: string;
  refundedAt: string | null;
  refundableUntil: string;
}

export interface SalesMonth {
  month: string;
  lines: { saleId: string; soldAt: string; tagCode: string; description: string; priceCents: number; consignorShareCents: number; commissionCents: number; vatCents: number; consignorName: string }[];
  totals: { priceCents: number; consignorShareCents: number; commissionCents: number; vatCents: number };
}

export interface Payout {
  id: string;
  consignorId: string;
  consignorName: string;
  iban: string | null;
  amountCents: number;
  status: "paid" | "held_back";
  reason: string | null;
}

export interface Run {
  month: string;
  status: "ready";
  startedAt: string;
  startedBy: { id: string; name: string };
  readyAt: string;
  msgId: string;
  controlSumCents: number;
  payouts: Payout[];
}

export type RunSummary = Omit<Run, "payouts">;

export interface Consignor {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  iban: string | null;
  ibanValid: boolean;
  status: ConsignorStatus;
  createdAt: string;
}

export interface SlotWeek {
  weekStart: string;
  previousWeek: string | null;
  nextWeek: string | null;
  slots: { startsAt: string; endsAt: string; free: boolean }[];
}

export interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  name: string;
  email: string;
}

export interface ImportCounts {
  matched: number;
  new: number;
  refused: number;
  already: number;
}

export interface ImportPreview {
  rows: { row: number; itemNo: string; status: "matched" | "new" | "refused" | "already"; consignorName: string; reason: string | null }[];
  counts: ImportCounts;
}

export interface ImportSaved {
  counts: ImportCounts;
  piecesCreated: number;
  consignorsCreated: number;
}

export interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

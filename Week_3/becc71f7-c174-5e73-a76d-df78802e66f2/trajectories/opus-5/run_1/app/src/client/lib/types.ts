import type {
  Category,
  Choice,
  Condition,
  ConsignorStatus,
  Payment,
  PayoutStatus,
  PieceStatus,
  Role,
  Size,
  StationName,
  StationState,
} from '../../shared/options.js';

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt?: string;
}

export interface Session {
  member: Member;
  homeRoute: string;
}

export interface Station {
  station: StationName;
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
  size: Size;
  condition: Condition;
  status: PieceStatus;
  station: StationName;
  currentPriceCents: number;
  previousPriceCents: number | null;
  photoUrls: string[];
}

export interface PublicPiece extends RailPiece {
  stations: Station[];
  soldAt: string | null;
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

export interface Hold {
  id: string;
  pieceId: string;
  tagCode?: string;
  shopperName?: string;
  shopperEmail?: string;
  startsAt: string;
  endsAt: string;
  status: 'active' | 'released' | 'ended';
}

export interface HoldPage {
  status: 'active' | 'released' | 'ended';
  endsAt: string;
  secondsLeft: number;
  piece: {
    tagCode: string;
    description: string;
    brand: string;
    size: Size;
    currentPriceCents: number;
    photoUrl: string | null;
  };
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

export interface SalesBookLine {
  saleId: string;
  soldAt: string;
  tagCode: string;
  description: string;
  priceCents: number;
  consignorShareCents: number;
  commissionCents: number;
  vatCents: number;
  consignorName: string;
}

export interface SalesBookTotals {
  priceCents: number;
  consignorShareCents: number;
  commissionCents: number;
  vatCents: number;
}

export interface SalesBook {
  month: string;
  lines: SalesBookLine[];
  totals: SalesBookTotals;
}

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

export interface ConsignorPayout {
  id: string;
  month: string;
  amountCents: number;
  status: PayoutStatus;
  reason: string | null;
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

export interface Payout {
  id: string;
  consignorId: string;
  consignorName: string;
  iban: string | null;
  amountCents: number;
  status: PayoutStatus;
  reason: string | null;
}

export interface PayoutRun {
  month: string;
  status: string;
  startedAt: string;
  startedBy: { id: string; name: string };
  readyAt: string | null;
  msgId: string;
  controlSumCents: number;
  payouts?: Payout[];
}

export interface PortalPiece {
  id: string;
  tagCode: string;
  description: string;
  category: Category;
  brand: string;
  size: Size;
  status: PieceStatus;
  station: StationName;
  currentPriceCents: number | null;
  previousPriceCents: number | null;
  stations: Station[];
  choice: Choice | null;
  choiceOpen: boolean;
  choiceOpensAt: string;
  choiceClosesAt: string;
  shareCents: number | null;
}

export interface PortalPage {
  consignor: { name: string; ibanLast4: string | null; ibanValid: boolean };
  pageEndsAt: string;
  pieces: PortalPiece[];
  earnings: { month: string; shareCents: number }[];
}

export interface Slot {
  startsAt: string;
  endsAt: string;
  free: boolean;
}

export interface SlotWeek {
  weekStart: string;
  previousWeek: string | null;
  nextWeek: string | null;
  slots: Slot[];
}

export interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  name?: string;
  email?: string;
  status?: 'booked' | 'cancelled';
}

export interface ImportRow {
  row: number;
  itemNo: string;
  status: 'matched' | 'new' | 'refused' | 'already';
  consignorName: string;
  reason: string | null;
}

export interface ImportPreview {
  rows: ImportRow[];
  counts: { matched: number; new: number; refused: number; already: number };
}

export interface ImportResult {
  counts: { matched: number; new: number; refused: number; already: number };
  piecesCreated: number;
  consignorsCreated: number;
}

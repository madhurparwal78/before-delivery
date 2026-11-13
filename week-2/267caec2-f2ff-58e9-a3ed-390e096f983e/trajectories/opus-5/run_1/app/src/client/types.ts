export interface User {
  id: string;
  role: 'director' | 'juror' | 'studio';
  name: string;
  email: string;
  studioId: string | null;
  studioName: string | null;
}

export interface Category {
  id: string;
  name: string;
  shortlistSize: number;
  finalistCount: number;
  rounds?: { id: string; name: string; kind: 'round_1' | 'final'; state: RoundState }[];
}

export interface Program {
  id: string;
  name: string;
  year: number;
  timeZone: string;
  earlyBirdDate: string;
  deadlineDate: string;
  earlyBirdEndsAt: string;
  deadlineAt: string;
  earlyBirdLabel: string;
  deadlineLabel: string;
  earlyBirdFeeCents: number;
  standardFeeCents: number;
  currentTier: 'early_bird' | 'standard';
  currentFeeCents: number;
  entriesOpen: boolean;
  categories: Category[];
}

export interface Asset {
  id: string;
  url: string;
  name: string;
  type: string;
  width: number;
  height: number;
  bytes: number;
}

export interface Entry {
  id: string;
  entryNumber: number;
  programId: string;
  categoryId: string;
  categoryName: string;
  title: string;
  summary: string;
  siteUrl: string;
  credits: string;
  state: string;
  statusLabel: string;
  disqualifyReason: string | null;
  award: string | null;
  score: string | null;
  assets: Asset[];
  fee: { tier: 'early_bird' | 'standard'; amountCents: number } | null;
  submittedAt: string | null;
  deadlineLabel: string;
  canWithdraw: boolean;
  refundOnWithdraw: boolean;
  studioId?: string;
  studioName?: string;
  studioEmail?: string;
}

export interface Receipt {
  entryNumber: number;
  title: string;
  amountCents: number;
  currency: string;
  tier: 'early_bird' | 'standard';
  invoiceId: string;
  paymentId: string;
  paidAt: string;
  refund: { amountCents: number; refundedAt: string } | null;
}

export type RoundState = 'scheduled' | 'open' | 'closed' | 'normalised' | 'published';

export interface Round {
  id: string;
  categoryId: string;
  name: string;
  kind: 'round_1' | 'final';
  state: RoundState;
  ballotDeadline: string | null;
  ballotDeadlineLabel: string | null;
  ballotDeadlineAt: string | null;
  openedAt: string | null;
  closedAt: string | null;
}

export interface PanelMember {
  jurorId: string;
  name: string;
  assigned: number;
  scored: number;
  remaining: number;
  ballotSubmitted: boolean;
}

export interface StandingRow {
  rank: number;
  entryId: string;
  entryNumber: number;
  title: string;
  categoryName: string;
  score: string | null;
  ideaMean: number | null;
  ballotsCounted: number;
  cut: 'above' | 'below';
  award: string | null;
}

export interface Standings {
  provisional: boolean;
  cut: number;
  cutLabel: string;
  rows: StandingRow[];
}

export interface LeaderRow {
  rank: number;
  entryNumber: number;
  title: string;
  studioName: string;
  score: string | null;
  previousRank: number | null;
  previousScore: string | null;
  award: string | null;
  cut: 'above' | 'below';
}

export interface LeaderCategory {
  id: string;
  name: string;
  state: 'pending' | 'embargoed' | 'revealed';
  revealsAt: string | null;
  revealsLabel: string | null;
  cut: number;
  rows: LeaderRow[];
}

export interface Leaderboard {
  program: { id: string; name: string; year: number; timeZone: string } | null;
  categories: LeaderCategory[];
}

export interface GalleryItem {
  entryNumber: number;
  title: string;
  studioName: string;
  programName: string;
  year: number;
  category: string;
  award: string;
  score: string | null;
  images: string[];
}

export interface BlindEntry {
  entryId: string;
  entryNumber: number;
  title: string;
  summary: string;
  images: { url: string; width: number; height: number }[];
  scores: { craft: number; clarity: number; idea: number; story: number } | null;
}

export interface Ballot {
  round: {
    id: string;
    name: string;
    categoryName: string;
    ballotDeadlineLabel: string | null;
    ballotDeadlineAt: string | null;
    state: RoundState;
  };
  entries: BlindEntry[];
  assigned: number;
  scored: number;
  remaining: number;
  submitted: boolean;
}

export interface JurorRound {
  id: string;
  name: string;
  categoryName: string;
  ballotDeadlineLabel: string | null;
  assigned: number;
  remaining: number;
  ballotSubmitted: boolean;
}

export interface Juror {
  id: string;
  name: string;
  email: string;
  studioId: string | null;
}

export interface Studio {
  id: string;
  name: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  at: string;
  detail: Record<string, unknown>;
}

export interface CategorySummary {
  id: string;
  name: string;
  counts: Record<string, number>;
  rounds: { id: string; name: string; state: RoundState; panel: PanelMember[] }[];
}

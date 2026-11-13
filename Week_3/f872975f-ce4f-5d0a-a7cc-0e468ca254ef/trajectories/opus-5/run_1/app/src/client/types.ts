export type Unit = 'mm' | 'in';

import { DefectZone, PiecePlacement } from '../shared/geometry';

export type { DefectZone };
export type Piece = PiecePlacement;

export interface BoardSummary {
  tag: string;
  species: string;
  grade: string | null;
  status: string;
  lot: { id: string; name: string };
  length_mm: number;
  width_mm: number;
  thickness_mm: number;
  volume_mm3: number;
  board_feet: string;
  rate_cents: number | null;
  price_cents: number | null;
  longest_clear_mm: number;
  defects: DefectZone[];
  parent_tag: string | null;
}

export interface Photo {
  id: string;
  url: string;
  thumb_url: string;
  width: number;
  height: number;
}

export interface Hold {
  id: string;
  board: string;
  status: 'pending-payment' | 'held' | 'released' | 'converted-to-sale';
  release_reason: null | 'cancelled' | 'expired' | 'payment-failed';
  pieces: Piece[];
  cuts_mm: number[];
  take_mm: number;
  sale: 'cut' | 'whole';
  offcut_mm: number | null;
  price_cents: number;
  deposit_cents: number;
  created_at: string;
  held_at: string | null;
  expires_at: string | null;
  killbill_payment_id: string | null;
}

export interface Board extends BoardSummary {
  lot: { id: string; name: string; origin: string; built_year: number };
  photos: Photo[];
  my_hold: Hold | null;
}

export interface FitPiece extends Piece {
  status: 'clear' | 'over defect' | 'overlap' | 'off board' | 'too wide';
}

export interface Fit {
  board: string;
  pieces: FitPiece[];
  clear_count: number;
  cuts_mm: number[];
  take_mm: number | null;
  sale: 'cut' | 'whole' | null;
  offcut_mm: number | null;
  clear_offcut_mm: number | null;
  board_feet: string | null;
  price_cents: number | null;
  verdict: string;
}

export interface Lot {
  id: string;
  name: string;
  origin: string;
  built_year: number;
}

export interface Rate {
  species: string;
  grade: string;
  rate_cents: number;
  effective_at: string;
}

export interface StockRow {
  species: string;
  open_boards: number;
  on_rack: number;
  held: number;
  volume_mm3: number;
  board_feet: string;
}

export interface TicketEvent {
  kind: string;
  by: { name: string };
  at: string;
}

export interface Ticket {
  id: string;
  status: 'issued' | 'at-saw' | 'done';
  board: string;
  maker: { name: string };
  pieces: Piece[];
  cuts_mm: number[];
  take_mm: number;
  sale: 'cut' | 'whole';
  offcut: { tag: string; planned_mm: number; measured_mm: number | null } | null;
  pdf_key: string;
  created_at: string;
  events: TicketEvent[];
}

export interface InvoiceLine {
  label: string;
  length_mm: number;
  amount_cents: number;
}

export interface Invoice {
  id: string;
  ticket: string;
  board: string;
  price_cents: number;
  deposit_cents: number;
  amount_cents: number;
  lines: InvoiceLine[];
  status: string;
  paid_at: string;
  killbill_payment_id: string | null;
}

export interface Sale {
  ticket: string;
  invoice: string;
  board: string;
  sale: 'cut' | 'whole';
  sold_mm: number;
  offcut: { tag: string; length_mm: number } | null;
  price_cents: number;
  deposit_cents: number;
  amount_cents: number;
  killbill_payment_id: string;
  pdf_url: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'hand' | 'maker';
}

export interface LayoutFilePiece extends Piece {
  [key: string]: unknown;
}

export interface LayoutFile {
  format: string;
  version: number;
  board: string;
  unit: string;
  pieces: LayoutFilePiece[];
  [key: string]: unknown;
}

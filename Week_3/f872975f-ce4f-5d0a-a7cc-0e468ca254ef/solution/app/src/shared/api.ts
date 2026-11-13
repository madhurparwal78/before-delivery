// Response shapes of the HTTP API, shared by the server serialisers and the browser.
import type {
  BoardStatus, DefectZone, Grade, HoldStatus, Piece, PieceStatus, ReleaseReason, Sale, Species, TicketStatus,
} from "./domain";

export type Role = "owner" | "hand" | "maker";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface Lot {
  id: string;
  name: string;
  origin: string;
  built_year: number;
}

export interface BoardSummary {
  tag: string;
  species: Species;
  grade: Grade | null;
  status: BoardStatus;
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
  status: HoldStatus;
  release_reason: ReleaseReason | null;
  pieces: Piece[];
  cuts_mm: number[];
  take_mm: number;
  sale: Sale;
  offcut_mm: number | null;
  price_cents: number;
  deposit_cents: number;
  created_at: string;
  held_at: string | null;
  expires_at: string | null;
  killbill_payment_id: string | null;
  maker?: { name: string };
}

export interface Board extends Omit<BoardSummary, "lot"> {
  lot: Lot;
  photos: Photo[];
  my_hold: Hold | null;
}

export interface Fit {
  board: string;
  pieces: (Piece & { status: PieceStatus })[];
  clear_count: number;
  cuts_mm: number[];
  take_mm: number | null;
  sale: Sale | null;
  offcut_mm: number | null;
  clear_offcut_mm: number | null;
  board_feet: string | null;
  price_cents: number | null;
  verdict: string;
}

export interface Rate {
  species: Species;
  grade: Grade;
  rate_cents: number;
  effective_at: string;
}

export interface StockFigures {
  open_boards: number;
  on_rack: number;
  held: number;
  volume_mm3: number;
  board_feet: string;
}

export interface StockRow extends StockFigures {
  species: Species;
}

export interface TicketEvent {
  kind: "issued" | "started" | "done";
  by: { name: string };
  at: string;
}

export interface Ticket {
  id: string;
  status: TicketStatus;
  board: string;
  maker: { name: string };
  pieces: Piece[];
  cuts_mm: number[];
  take_mm: number;
  sale: Sale;
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
  status: "paid";
  paid_at: string;
  killbill_payment_id: string;
}

export interface SaleResult {
  ticket: string;
  invoice: string;
  board: string;
  sale: Sale;
  sold_mm: number;
  offcut: { tag: string; length_mm: number } | null;
  price_cents: number;
  deposit_cents: number;
  amount_cents: number;
  killbill_payment_id: string;
  pdf_url: string;
}

export interface Services {
  billing: "up" | "down";
  storage: "up" | "down";
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

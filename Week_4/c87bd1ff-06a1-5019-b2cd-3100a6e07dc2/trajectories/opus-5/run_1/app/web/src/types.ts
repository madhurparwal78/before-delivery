export type LotStatus = "open" | "extended" | "closed_sold" | "closed_unsold";

export interface Lot {
  id: string;
  sale_id: string | null;
  lot_number: number | null;
  title: string;
  category: string;
  description: string;
  condition: string;
  portrait: string | null;
  estimate_low: number | null;
  estimate_high: number | null;
  opening_bid: number | null;
  price: number | null;
  asking: number;
  bid_count: number;
  leader_paddle: number | null;
  reserve_met: boolean;
  status: LotStatus;
  closes_at: string | null;
  remaining_seconds: number;
  server_now: string;
  my_max?: number | null;
  i_lead?: boolean;
  watching?: boolean;
}

export interface ConsignorLot {
  id: string;
  sale_id: string | null;
  lot_number: number | null;
  title: string;
  category: string;
  description: string;
  condition: string;
  portrait: string | null;
  estimate_low: number | null;
  estimate_high: number | null;
  opening_bid: number | null;
  reserve: number | null;
  price: number | null;
  bid_count: number;
  reserve_met: boolean;
  state: string;
  closes_at: string | null;
  remaining_seconds: number;
  server_now: string;
  hammer: number | null;
  second_chance_open: boolean;
  offer: Offer | null;
  consignor_name?: string;
  leader_paddle?: number | null;
}

export interface HistoryRow {
  paddle?: number;
  bid_id?: string;
  bidder_name?: string;
  max_amount?: number;
  price_after: number;
  accepted_at: string;
}

export interface Offer {
  id: string;
  lot_id: string;
  lot_number: number;
  title: string;
  kind: "second_chance" | "default";
  amount: number;
  expires_at: string;
  status: "open" | "accepted" | "declined" | "expired";
}

export interface InvoiceLine {
  lot_id: string;
  lot_number: number;
  title: string;
  source: string;
  hammer: string;
  premium: string;
  vat: string;
}

export interface Invoice {
  id: string;
  number: string;
  sale_id: string;
  sale_title: string;
  paddle: number | null;
  status: "issued" | "paid" | "defaulted";
  issued_at: string;
  due_at: string;
  lines: InvoiceLine[];
  hammer_total: string;
  premium_total: string;
  vat_total: string;
  total: string;
  paid: string;
  outstanding: string;
  payments: { amount: string; method: string; recorded_at: string }[];
  bidder_name?: string;
}

export interface StatementLine {
  lot_id: string;
  lot_number: number;
  title: string;
  result: "sold" | "unsold";
  hammer: string | null;
  commission: string | null;
  net: string | null;
}

export interface Statement {
  id: string;
  number: string;
  sale_id: string;
  sale_title: string;
  version: number;
  status: "draft" | "issued" | "superseded";
  issued_at: string | null;
  supersedes: string | null;
  superseded_by: string | null;
  lines: StatementLine[];
  hammer_total: string;
  commission_total: string;
  net_total: string;
  consignor_id?: string;
}

export interface Sale {
  id: string;
  title: string;
  ends_at: string;
  state: "draft" | "open" | "closed";
  first_lot_number: number;
}

export interface Notice {
  id: string;
  kind: string;
  text: string;
  lot_id: string | null;
  created_at: string;
}

export interface Registration {
  id: string;
  full_name: string;
  phone: string;
  address: string;
  status: string;
  created_at: string;
}

export type Frame =
  | {
      seq: number;
      type: "lot_changed";
      cause: "bid" | "extension" | "removal" | "close" | "offer" | "watch";
      lot: Lot & ConsignorLot;
      history: HistoryRow[];
    }
  | { seq: number; type: "notice"; notice: Notice };

export interface Viewer {
  signed_in: boolean;
  name: string;
  roles: string[];
  registration: string;
  status: string;
  paddle: number | null;
  spending_limit: number | null;
}

export interface Boot {
  route: string;
  id: string;
  data: Record<string, unknown>;
  viewer: Viewer;
  durations: Record<string, number>;
}

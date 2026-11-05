export type Role = 'coordinator' | 'member' | 'volunteer';

export type CycleStatus =
  | 'draft'
  | 'open'
  | 'sealing'
  | 'ordered'
  | 'received'
  | 'breakdown'
  | 'closing'
  | 'closed';

export type LineStatus = 'filling' | 'sealed' | 'dropped' | 'taken_up';

export type UnitKind = 'jar' | 'bottle' | 'jug' | 'lb';

export type Cell = 'mine' | 'taken' | 'empty';

export interface Credit {
  balance_cents: number;
  held_cents: number;
  spendable_cents: number;
}

export interface Line {
  product_id: string;
  case_name: string;
  pack: number;
  unit: UnitKind;
  price_cents: number;
  version: number;
  pledged_units: number;
  units_to_go: number;
  status: LineStatus;
  short_units: number;
  my_units: number | null;
  cells: Cell[];
}

export interface Cycle {
  id: string;
  name: string;
  status: CycleStatus;
  revision: number;
  cutoff_at: string | null;
  cutoff_display: string | null;
  pickup_start_at: string | null;
  pickup_end_at: string | null;
  pickup_display: string | null;
  accepting_pledges: boolean;
  credit: Credit | null;
  lines: Line[];
}

export interface CycleSummary {
  id: string;
  name: string;
  status: CycleStatus;
  cutoff_display: string | null;
}

export interface Me {
  role: Role;
  name: string;
  household_code: string | null;
}

export interface Club {
  name: string;
  time_zone: string;
  distributor: string;
}

export interface CatalogProduct {
  id: string;
  case_name: string;
  pack: number;
  unit: UnitKind;
  price_cents: number;
}

export interface Share {
  pledger: string;
  units: number;
  first_unit: number;
  share_cents: number;
}

export interface SharesResponse {
  price_cents: number;
  pack: number;
  unit_base_cents: number;
  remainder_cents: number;
  shares: Share[];
}

export interface BagItem {
  product_id: string;
  case_name: string;
  units: number;
  packed: boolean;
  flagged_units: number;
}

export interface Bag {
  household_code: string;
  household_name: string;
  packed: boolean;
  items: BagItem[];
}

export interface Flag {
  id: number;
  household_code: string;
  product_id: string;
  units: number;
  created_at: string;
}

export interface DailyRow {
  date: string;
  units_pledged: number;
  units_withdrawn: number;
}

export interface Receipt {
  household_code: string;
  email: string;
  status: 'queued' | 'sent';
  failed_attempts: number;
}

export interface Topup {
  id: number;
  amount_cents: number;
  status: 'confirmed';
  created_at: string;
}

export interface MovementLeg {
  account: string;
  amount_cents: number;
}

export interface Movement {
  id: number;
  kind: string;
  cycle_id: string | null;
  memo: string;
  created_at: string;
  legs: MovementLeg[];
}

export interface LedgerPage extends Credit {
  household_code: string;
  total_movements: number;
  next_before: string | null;
  movements: Movement[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export interface PledgeResponse {
  line: Line;
  credit: Credit;
}

export interface CloseResponse {
  cycle: Cycle;
  receipts_queued: number;
}

export interface DocumentRecord {
  kind: 'invoice' | 'packing-slip';
  key: string;
  bytes: number;
  sha256: string;
  uploaded_at?: string;
}

export interface ShortAffected {
  pledger: string;
  short_units: number;
  credit_cents: number;
}

export interface ShortResponse {
  short_id: number;
  line: Line;
  affected: ShortAffected[];
}

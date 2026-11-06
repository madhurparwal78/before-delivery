// The published API shapes (brief: API → Published field lists), shared by server views and the browser.

export type Role = "broker" | "beekeeper" | "grower";
export type Tier = "none" | "reduced" | "standard" | "bonus";
export type OrderStatus = "draft" | "open" | "filled" | "placed" | "inspected" | "settled" | "cancelled";
export type DropStatus = "committed" | "delivered" | "inspected" | "disputed" | "accepted";
export type LinkStatus = "issued" | "used" | "signed" | "expired";
export type SettlementStatus = "none" | "queued" | "settled";

export const TIER_LABELS: Record<Tier, string> = { none: "None", reduced: "Reduced", standard: "Standard", bonus: "Bonus" };
export const NOT_INSPECTED = "Not inspected";

export function tierLabel(tier: Tier | null): string {
  return tier === null ? NOT_INSPECTED : TIER_LABELS[tier];
}

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Draft",
  open: "Open",
  filled: "Filled",
  placed: "Placed",
  inspected: "Inspected",
  settled: "Settled",
  cancelled: "Cancelled",
};

export function orderStatusLabel(status: OrderStatus, settlement: SettlementStatus): string {
  return status === "inspected" && settlement === "queued" ? "Settlement queued" : ORDER_STATUS_LABELS[status];
}

export const DROP_STATUS_LABELS: Record<DropStatus, string> = {
  committed: "Committed",
  delivered: "Delivered",
  inspected: "Inspected",
  disputed: "Disputed",
  accepted: "Accepted",
};

export const LINK_STATUS_LABELS: Record<LinkStatus, string> = { issued: "Issued", used: "Used", signed: "Signed", expired: "Expired" };

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface Ref {
  id: string;
  name: string;
}

export interface OrchardSummary {
  id: string;
  name: string;
  county: string;
  blocks: { id: string; name: string; acres: number }[];
  orders: { id: string; ref: string; status: OrderStatus; bloom_start: string }[];
  grower?: Ref;
}

export interface Grower {
  id: string;
  name: string;
  contact_name: string;
  email: string;
}

export interface GrowerPlacement {
  yard_name: string;
  hives: number;
  delivered_on: string;
  average_frames: number | null;
}

export interface BrokerPlacement extends GrowerPlacement {
  drop_id: string;
  beekeeper: Ref;
  status: DropStatus;
  pay_per_hive_cents: number | null;
  payout_cents: number | null;
}

export interface GrowerBlock {
  id: string;
  name: string;
  acres: number;
  hives_ordered: number;
  hives_delivered: number;
  sample_count: number;
  average_frames: number | null;
  tier: Tier | null;
  payable_cents: number;
  placements: GrowerPlacement[];
}

export interface BrokerBlock extends Omit<GrowerBlock, "placements"> {
  placements: BrokerPlacement[];
}

export interface InspectionLinkView {
  id: string;
  status: LinkStatus;
  inspector_email: string;
  expires_at: string;
}

interface OrderCore {
  id: string;
  ref: string;
  status: OrderStatus;
  orchard: { id: string; name: string; county: string };
  bloom_start: string;
  bloom_end: string;
  delivery_deadline: string;
  hives_ordered: number;
}

export interface GrowerOrderListItem extends OrderCore {
  settlement_status: SettlementStatus;
  hives_delivered: number;
  deposit_cents: number;
  payable_cents: number;
  report_available: boolean;
}

export interface GrowerOrder extends GrowerOrderListItem {
  blocks: GrowerBlock[];
}

export interface BrokerOrderListItem extends GrowerOrderListItem {
  grower: Ref;
  hives_committed: number;
  rule_set: Ref;
  commission_bps: number;
  commission_cents: number;
  inspection_link: InspectionLinkView | null;
}

export interface BrokerOrder extends BrokerOrderListItem {
  blocks: BrokerBlock[];
}

export type TierPrices = Record<Tier, number>;

export interface BeekeeperBlock {
  id: string;
  name: string;
  hives_ordered: number;
  hives_delivered: number;
  average_frames: number | null;
  tier: Tier | null;
}

export interface Photo {
  id: string;
  colony_label: string;
  url: string;
}

export interface Drop {
  id: string;
  order: { id: string; ref: string };
  orchard: Ref;
  yard_name: string;
  hives: number;
  status: DropStatus;
  block: Ref | null;
  delivered_on: string | null;
  average_frames: number | null;
  block_average_frames: number | null;
  tier: Tier | null;
  pay_per_hive_cents: number | null;
  payout_cents: number | null;
  dispute_reason: string | null;
  resolution_note: string | null;
  photos: Photo[];
  beekeeper?: Ref;
}

export interface BeekeeperOrderListItem extends OrderCore {
  hives_remaining: number;
  pay_per_hive_cents: TierPrices;
}

export interface BeekeeperOrder extends BeekeeperOrderListItem {
  blocks: BeekeeperBlock[];
  my_drops: Drop[];
}

export type OrderListItem = GrowerOrderListItem | BrokerOrderListItem | BeekeeperOrderListItem;
export type AnyOrder = GrowerOrder | BrokerOrder | BeekeeperOrder;

export interface SettlementShare {
  beekeeper: Ref;
  hives: number;
  gross_cents: number;
  payout_cents: number;
}

export interface Settlement {
  status: "preview" | "queued" | "settled";
  payment_received_on: string | null;
  rule_set: Ref;
  payable_cents: number;
  commission_bps: number;
  commission_cents: number;
  shares: SettlementShare[];
}

export interface SheetSample {
  id: string;
  drop_id: string;
  colony_label: string;
  frames: number;
  photos: { id: string; url: string }[];
}

export interface SheetBlock {
  id: string;
  name: string;
  hives_delivered: number;
  samples_required: number;
  sample_count: number;
  average_frames: number | null;
  tier: Tier | null;
  payable_cents: number;
  yards: { drop_id: string; yard_name: string; hives: number }[];
  samples: SheetSample[];
}

export interface Sheet {
  order: { ref: string };
  orchard: { name: string; county: string };
  link: { status: LinkStatus; expires_at: string };
  blocks: SheetBlock[];
  payable_cents: number;
}

export interface BlockStrength {
  id: string;
  sample_count: number;
  average_frames: number | null;
  tier: Tier | null;
  payable_cents: number;
}

export interface SampleChange {
  sample?: SheetSample;
  block: BlockStrength;
  payable_cents: number;
}

export interface SignResult {
  status: "signed";
  signed_at: string;
  payable_cents: number;
  blocks: { id: string; average_frames: number | null; tier: Tier | null; payable_cents: number }[];
}

export interface ErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  remaining?: number;
}

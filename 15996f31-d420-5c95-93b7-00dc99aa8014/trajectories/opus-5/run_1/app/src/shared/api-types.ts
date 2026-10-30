import type {
  DropStatus,
  InspectionLinkStatus,
  OrderStatus,
  Role,
  SettlementStatus,
  Tier,
} from './labels';

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
}

export interface NamedRef {
  id: string;
  name: string;
}

export interface OrchardRef {
  id: string;
  name: string;
  county: string;
}

export interface Grower {
  id: string;
  name: string;
  contact_name: string;
  email: string;
}

export interface RuleSet {
  id: string;
  name: string;
  effective_from: string;
  thresholds: { reduced: number; standard: number; bonus: number };
  price_per_hive_cents: TierAmounts;
  commission_bps: number;
  deposit_per_hive_cents: number;
}

export interface TierAmounts {
  none: number;
  reduced: number;
  standard: number;
  bonus: number;
}

export interface OrchardBlockSummary {
  id: string;
  name: string;
  acres: number;
}

export interface OrchardOrderSummary {
  id: string;
  ref: string;
  status: OrderStatus;
  bloom_start: string;
}

export interface OrchardListItem {
  id: string;
  name: string;
  county: string;
  blocks: OrchardBlockSummary[];
  orders: OrchardOrderSummary[];
  grower?: NamedRef;
}

export interface GrowerPlacement {
  yard_name: string;
  hives: number;
  delivered_on: string;
  average_frames: number | null;
}

export interface BrokerPlacement extends GrowerPlacement {
  drop_id: string;
  beekeeper: NamedRef;
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

export interface BrokerBlock extends Omit<GrowerBlock, 'placements'> {
  placements: BrokerPlacement[];
}

export interface GrowerOrder {
  id: string;
  ref: string;
  status: OrderStatus;
  settlement_status: SettlementStatus;
  orchard: OrchardRef;
  bloom_start: string;
  bloom_end: string;
  delivery_deadline: string;
  hives_ordered: number;
  hives_delivered: number;
  deposit_cents: number;
  payable_cents: number;
  report_available: boolean;
  blocks: GrowerBlock[];
}

export interface InspectionLinkView {
  id: string;
  status: InspectionLinkStatus;
  inspector_email: string;
  expires_at: string;
}

export interface BrokerOrder extends Omit<GrowerOrder, 'blocks'> {
  blocks: BrokerBlock[];
  grower: NamedRef;
  hives_committed: number;
  rule_set: NamedRef;
  commission_bps: number;
  commission_cents: number;
  inspection_link: InspectionLinkView | null;
}

export interface BeekeeperBlock {
  id: string;
  name: string;
  hives_ordered: number;
  hives_delivered: number;
  average_frames: number | null;
  tier: Tier | null;
}

export interface BeekeeperOrder {
  id: string;
  ref: string;
  status: OrderStatus;
  orchard: OrchardRef;
  bloom_start: string;
  bloom_end: string;
  delivery_deadline: string;
  hives_ordered: number;
  hives_remaining: number;
  pay_per_hive_cents: TierAmounts;
  blocks: BeekeeperBlock[];
  my_drops: DropView[];
}

export interface DropPhoto {
  id: string;
  colony_label: string;
  url: string;
}

export interface DropView {
  id: string;
  order: { id: string; ref: string };
  orchard: NamedRef;
  yard_name: string;
  hives: number;
  status: DropStatus;
  block: NamedRef | null;
  delivered_on: string | null;
  average_frames: number | null;
  block_average_frames: number | null;
  tier: Tier | null;
  pay_per_hive_cents: number | null;
  payout_cents: number | null;
  dispute_reason: string | null;
  resolution_note: string | null;
  photos: DropPhoto[];
  beekeeper?: NamedRef;
}

export type GrowerOrderListItem = Omit<GrowerOrder, 'blocks'>;
export type BrokerOrderListItem = Omit<BrokerOrder, 'blocks'>;
export type BeekeeperOrderListItem = Omit<BeekeeperOrder, 'blocks' | 'my_drops'>;

export interface SettlementShare {
  beekeeper: NamedRef;
  hives: number;
  gross_cents: number;
  payout_cents: number;
}

export interface Settlement {
  status: 'preview' | 'queued' | 'settled';
  payment_received_on: string | null;
  rule_set: NamedRef;
  payable_cents: number;
  commission_bps: number;
  commission_cents: number;
  shares: SettlementShare[];
}

export interface InspectionYard {
  drop_id: string;
  yard_name: string;
  hives: number;
}

export interface InspectionSamplePhoto {
  id: string;
  url: string;
}

export interface InspectionSample {
  id: string;
  drop_id: string;
  colony_label: string;
  frames: number;
  photos: InspectionSamplePhoto[];
}

export interface InspectionBlock {
  id: string;
  name: string;
  hives_delivered: number;
  samples_required: number;
  sample_count: number;
  average_frames: number | null;
  tier: Tier | null;
  payable_cents: number;
  yards: InspectionYard[];
  samples: InspectionSample[];
}

export interface InspectionSheet {
  order: { ref: string };
  orchard: { name: string; county: string };
  link: { status: InspectionLinkStatus; expires_at: string };
  blocks: InspectionBlock[];
  payable_cents: number;
}

export interface BlockStrength {
  id: string;
  sample_count: number;
  average_frames: number | null;
  tier: Tier | null;
  payable_cents: number;
}

export interface SampleCreated {
  sample: InspectionSample;
  block: BlockStrength;
  payable_cents: number;
}

export interface SampleRemoved {
  block: BlockStrength;
  payable_cents: number;
}

export interface SignedReport {
  status: 'signed';
  signed_at: string;
  payable_cents: number;
  blocks: Array<{
    id: string;
    average_frames: number | null;
    tier: Tier | null;
    payable_cents: number;
  }>;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  remaining?: number;
}

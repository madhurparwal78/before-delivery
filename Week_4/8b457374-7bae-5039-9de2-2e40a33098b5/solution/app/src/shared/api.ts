// The wire shapes of the brief's API (Backend › API). Plain data, shared by server and browser.

export type CampaignStatus = "draft" | "live" | "funded" | "collecting" | "settled" | "unfunded" | "cancelled";
export type PledgeState = "authorising" | "authorised" | "captured" | "errored" | "voided" | "dropped";
export type Zone = "domestic" | "europe" | "rest_of_world";
export type DocumentStatus = "none" | "pending" | "ready";
export type MediaKind = "cover" | "spread";
export type MediaStatus = "uploading" | "stored" | "failed";
export type ServiceState = "up" | "down";

export const ZONE_NAMES: Record<Zone, string> = {
  domestic: "Domestic",
  europe: "Europe",
  rest_of_world: "Rest of world",
};

export interface ApiErrorBody {
  error: string;
  fields?: Record<string, string>;
}

export interface Person {
  id: string;
  name: string;
  email: string;
}

export interface NewPerson extends Person {
  key: string;
}

export interface Shipping {
  domestic: number;
  europe: number;
  rest_of_world: number;
}

export interface Tier {
  id: string;
  title: string;
  description: string;
  price: number;
  quantity: number | null;
  claimed: number;
  remaining: number | null;
  shipping: Shipping;
}

interface StretchPoint {
  copies: number;
  amount: number;
  reached: boolean;
}

export interface Media {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  content_type: string;
  bytes: number;
}

export interface Campaign {
  id: string;
  title: string;
  story: string;
  status: CampaignStatus;
  pledging_open: boolean;
  creator: { id: string; name: string };
  goal: number;
  min_run_copies: number;
  stretch: StretchPoint[];
  ships_from: string;
  time_zone: string;
  deadline_local: string;
  deadline_utc: string;
  seconds_left: number | null;
  total: number;
  captured_total: number;
  backer_count: number;
  percent: number;
  media: Media[];
  tiers: Tier[];
}

export interface CampaignRow {
  id: string;
  title: string;
  status: CampaignStatus;
  total: number;
  goal: number;
  percent: number;
  pledging_open: boolean;
  cover_media_id: string | null;
}

export interface Quote {
  tier_id: string;
  zone: Zone;
  reward: number;
  shipping: number;
  add_on: number;
  amount: number;
  projected_total: number;
  projected_percent: number;
}

export interface Fees {
  platform_fee: number;
  processing_fee: number;
  to_creator: number;
}

export interface Pledge {
  id: string;
  campaign_id: string;
  tier_id: string;
  country: string;
  zone: Zone;
  reward: number;
  shipping: number;
  add_on: number;
  amount: number;
  state: PledgeState;
  card_last4: string;
  replaces: string | null;
  created_at: string;
  history: { state: PledgeState; at: string }[];
  statement: DocumentStatus;
  fees: Fees | null;
  fix_deadline_utc: string | null;
  fix_seconds_left: number | null;
  card_fixed: boolean | null;
}

/** The backer's own view adds the fix code that opens their fix page. */
export interface OwnPledge extends Pledge {
  fix_code: string | null;
}

export interface MyPledge extends OwnPledge {
  campaign: { id: string; title: string; status: CampaignStatus; cover_media_id: string | null };
}

export interface BackerPledge extends Pledge {
  backer: Person;
}

export interface PledgeResult extends OwnPledge {
  campaign_total: number;
  campaign_percent: number;
  key?: string;
}

export interface FixView {
  pledge_id: string;
  campaign_title: string;
  amount: number;
  state: PledgeState;
  fix_deadline_utc: string | null;
  fix_seconds_left: number | null;
  card_fixed: boolean | null;
}

interface SettlementLine {
  pledge_id: string;
  amount: number;
  platform_fee: number;
  processing_fee: number;
  to_creator: number;
}

export interface Settlement {
  campaign_id: string;
  status: CampaignStatus;
  captured_count: number;
  dropped_count: number;
  errored_count: number;
  gross: number;
  platform_fee: number;
  processing_fee: number;
  net: number;
  lines: SettlementLine[];
  pdf: DocumentStatus;
}

export interface ServiceStatus {
  payments: ServiceState;
  email: ServiceState;
  storage: ServiceState;
  documents: ServiceState;
}

import type { Zone } from './countries.js';

export type CampaignStatus =
  | 'draft'
  | 'live'
  | 'funded'
  | 'collecting'
  | 'settled'
  | 'unfunded'
  | 'cancelled';

export type PledgeState =
  | 'authorising'
  | 'authorised'
  | 'captured'
  | 'errored'
  | 'voided'
  | 'dropped';

export type MediaKind = 'cover' | 'spread';
export type MediaStatus = 'uploading' | 'stored' | 'failed';
export type DocumentStatus = 'none' | 'pending' | 'ready';
export type ServiceState = 'up' | 'down';

export interface StretchPointDto {
  copies: number;
  amount: number;
  reached: boolean;
}

export interface MediaDto {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  content_type: string;
  bytes: number;
}

export interface TierDto {
  id: string;
  title: string;
  description: string;
  price: number;
  quantity: number | null;
  claimed: number;
  remaining: number | null;
  shipping: { domestic: number; europe: number; rest_of_world: number };
}

export interface CampaignDto {
  id: string;
  title: string;
  story: string;
  status: CampaignStatus;
  pledging_open: boolean;
  creator: { id: string; name: string };
  goal: number;
  min_run_copies: number;
  stretch: StretchPointDto[];
  ships_from: string;
  time_zone: string;
  deadline_local: string;
  deadline_utc: string;
  seconds_left: number | null;
  total: number;
  captured_total: number;
  backer_count: number;
  percent: number;
  media: MediaDto[];
  tiers: TierDto[];
}

export interface CampaignRowDto {
  id: string;
  title: string;
  status: CampaignStatus;
  total: number;
  goal: number;
  percent: number;
  pledging_open: boolean;
  cover_media_id: string | null;
}

export interface QuoteDto {
  tier_id: string;
  zone: Zone;
  reward: number;
  shipping: number;
  add_on: number;
  amount: number;
  projected_total: number;
  projected_percent: number;
}

export interface PledgeFeesDto {
  platform_fee: number;
  processing_fee: number;
  to_creator: number;
}

export interface PledgeDto {
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
  card_last4: string | null;
  replaces: string | null;
  created_at: string;
  history: { state: PledgeState; at: string }[];
  statement: DocumentStatus;
  fees: PledgeFeesDto | null;
  fix_deadline_utc: string | null;
  fix_seconds_left: number | null;
  card_fixed: boolean | null;
  /** Only ever sent to the pledge's own backer, so they can open their fix page. */
  fix_code: string | null;
}

export interface PledgeWithCampaignDto extends PledgeDto {
  campaign: {
    id: string;
    title: string;
    status: CampaignStatus;
    cover_media_id: string | null;
  };
}

export interface PledgeWithBackerDto extends PledgeDto {
  backer: { id: string; name: string; email: string };
}

export interface PledgeResultDto extends PledgeDto {
  campaign_total: number;
  campaign_percent: number;
}

export interface PersonDto {
  id: string;
  name: string;
  email: string;
}

export interface PersonWithKeyDto extends PersonDto {
  key: string;
}

export interface NoticeDto {
  kind: string;
  to: string;
  subject: string;
  status: 'queued' | 'sent';
  created_at: string;
  sent_at: string | null;
}

export interface SettlementLineDto {
  pledge_id: string;
  amount: number;
  platform_fee: number;
  processing_fee: number;
  to_creator: number;
}

export interface SettlementDto {
  campaign_id: string;
  status: CampaignStatus;
  captured_count: number;
  dropped_count: number;
  errored_count: number;
  gross: number;
  platform_fee: number;
  processing_fee: number;
  net: number;
  lines: SettlementLineDto[];
  pdf: DocumentStatus;
}

export interface StatusDto {
  payments: ServiceState;
  email: ServiceState;
  storage: ServiceState;
  documents: ServiceState;
}

export interface FixDto {
  pledge_id: string;
  campaign_title: string;
  amount: number;
  state: PledgeState;
  fix_deadline_utc: string;
  fix_seconds_left: number;
  card_fixed: boolean;
}

export interface ApiErrorDto {
  error: string;
  fields?: Record<string, string>;
}

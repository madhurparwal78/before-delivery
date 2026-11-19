/** The published wire shapes, built from explicit field lists on the server. */

import type { BandId, Facing, StackLetter, ViewTag } from './units';

export type UnitStatus = 'available' | 'held' | 'reserved';
export type CellStatus = UnitStatus | 'withdrawn' | 'unreleased';
export type HoldStatus = 'active' | 'released' | 'lapsed' | 'converted';
export type HoldEndReason = 'buyer' | 'withdrawal' | 'lapse' | 'conversion';
export type AccountRole = 'buyer' | 'coordinator';

export interface PublicUnit {
  code: string;
  floor: number;
  stack: StackLetter;
  band: BandId;
  bedrooms: number;
  areaM2: number;
  areaSqft: number;
  bearing: number;
  facing: Facing;
  viewTag: ViewTag;
  price: number;
  pricePerM2: number;
  pricePerSqft: number;
  priceVersion: number;
  status: UnitStatus;
  syncing: boolean;
  viewPhotographed: boolean;
  viewUrl: string | null;
}

export interface SharedUnit {
  code: string;
  floor: number;
  stack: StackLetter;
  band: BandId;
  bedrooms: number;
  areaM2: number;
  areaSqft: number;
  bearing: number;
  facing: Facing;
  viewTag: ViewTag;
  viewPhotographed: boolean;
  viewUrl: string | null;
}

export interface TowerCell {
  code: string;
  floor: number;
  stack: StackLetter;
  status: CellStatus;
  syncing: boolean;
}

export interface TowerResponse {
  units: TowerCell[];
  assets: {
    shell: string;
    plates: Record<BandId, string>;
    facade: string;
    ramp: string;
  };
}

export interface Hold {
  id: string;
  unitCode: string;
  status: HoldStatus;
  endedBy: HoldEndReason | null;
  quotedPrice: number;
  priceVersion: number;
  createdAt: string;
  endsAt: string;
  endedAt: string | null;
  shareUrl: string | null;
}

export interface Account {
  email: string;
  name: string;
  role: AccountRole;
}

export interface PriceVersionRow {
  version: number;
  price: number;
  setBy: string;
  setAt: string;
}

export type FacetName = 'bedrooms' | 'band' | 'facing' | 'view' | 'status';

export interface SearchResponse {
  total: number;
  hits: PublicUnit[];
  facets: Record<FacetName, Record<string, number>>;
  priceStats: { min: number; max: number } | null;
  matchingCodes: string[];
  nextCursor: string | null;
}

export interface ConsoleUnitRow {
  code: string;
  floor: number;
  stack: StackLetter;
  band: BandId;
  status: CellStatus;
  price: number;
  priceVersion: number;
  viewPhotographed: boolean;
  viewPhoto: { key: string; size: number; checksum: string } | null;
  hold: {
    id: string;
    buyerEmail: string;
    quotedPrice: number;
    createdAt: string;
    endsAt: string;
  } | null;
}

export interface ConsoleHoldRow {
  id: string;
  unitCode: string;
  buyerEmail: string;
  buyerName: string;
  quotedPrice: number;
  priceVersion: number;
  createdAt: string;
  endsAt: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

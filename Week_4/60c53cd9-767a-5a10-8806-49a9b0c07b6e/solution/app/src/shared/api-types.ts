/** The published API objects, as they appear on the wire. Built from explicit field lists on the server. */
import type { CellStatus, LiveStatus } from "./domain.js";
import type { FacetName } from "./search-rules.js";

export interface PublicUnit {
  code: string;
  floor: number;
  stack: string;
  band: string;
  bedrooms: number;
  areaM2: number;
  areaSqft: number;
  bearing: number;
  facing: string;
  viewTag: string;
  price: number;
  pricePerM2: number;
  pricePerSqft: number;
  priceVersion: number;
  status: LiveStatus;
  syncing: boolean;
  viewPhotographed: boolean;
  viewUrl: string | null;
}

export interface SharedUnit {
  code: string;
  floor: number;
  stack: string;
  band: string;
  bedrooms: number;
  areaM2: number;
  areaSqft: number;
  bearing: number;
  facing: string;
  viewTag: string;
  viewPhotographed: boolean;
  viewUrl: string | null;
}

export interface TowerCell {
  code: string;
  floor: number;
  stack: string;
  status: CellStatus;
  syncing: boolean;
}

export interface TowerAssets {
  shell: string;
  plates: Record<string, string>;
  facade: string;
  ramp: string;
}

export interface PublicHold {
  id: string;
  unitCode: string;
  status: "active" | "released" | "lapsed" | "converted";
  endedBy: "buyer" | "withdrawal" | "lapse" | "conversion" | null;
  quotedPrice: number;
  priceVersion: number;
  createdAt: string;
  endsAt: string;
  endedAt: string | null;
  shareUrl: string | null;
}

export interface PublicAccount {
  email: string;
  name: string;
  role: "buyer" | "coordinator";
}

export interface SearchReply {
  total: number;
  hits: PublicUnit[];
  facets: Record<FacetName, Record<string, number>>;
  priceStats: { min: number; max: number } | null;
  matchingCodes: string[];
  nextCursor: string | null;
}

export interface ConsoleUnit {
  code: string;
  floor: number;
  stack: string;
  band: string;
  status: string;
  price: number;
  priceVersion: number;
  viewPhotographed: boolean;
  viewPhoto: { key: string; size: number; checksum: string } | null;
  hold: { id: string; buyerEmail: string; quotedPrice: number; createdAt: string; endsAt: string } | null;
}

export interface ConsoleHold {
  id: string;
  unitCode: string;
  buyerEmail: string;
  buyerName: string;
  quotedPrice: number;
  priceVersion: number;
  createdAt: string;
  endsAt: string;
}

export interface PriceVersion {
  version: number;
  price: number;
  setBy: string;
  setAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

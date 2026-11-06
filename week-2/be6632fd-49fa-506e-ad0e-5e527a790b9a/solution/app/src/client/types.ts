// The API shapes the staff screens read (brief: API → Objects).
import type { Market } from "../shared/time";

export type DropStatus = "draft" | "scheduled" | "live" | "sold_out" | "withdrawn";

export interface StaffDrop {
  id: string;
  slug: string;
  name: string;
  type: "simultaneous" | "rolling";
  status: DropStatus;
  holdSeconds: number;
  palette: string[];
  internalNote: string;
  goLiveAt: string | null;
  copenhagenGoLive: string | null;
  localGoLive: string | null;
  markets: Array<{ market: Market; city: string; goLiveAt: string | null; storePieces: number; claimed: number; held: number; piecesLeft: number; status: string }>;
  styles: Array<{ styleNumber: string; name: string; colour: string; wholesaleEdition?: number; rrpDkkMinor?: number }>;
  createdAt: string;
  withdrawnAt: string | null;
}

export interface AllocationLine {
  styleNumber: string;
  styleName: string;
  requestedQuantity: number;
  allocatedQuantity: number;
  unitPriceMinor: number | null;
  netMinor: number | null;
  vatMinor: number | null;
  lineTotalMinor: number | null;
}

export interface Allocation {
  id: string;
  dropId: string;
  dropName: string;
  stockistId: string;
  stockistName: string;
  market: Market;
  currency: string;
  status: "requested" | "split" | "confirmed";
  version: number;
  requestedAt: string | null;
  lines: AllocationLine[];
  totalMinor: number | null;
  priceListEffectiveDate: string | null;
  invoiceNumber: string | null;
  killbillInvoiceId: string | null;
  contactName: string | null;
  internalNote: string;
  savedBy: string;
  savedAt: string;
  confirmedAt: string | null;
}

export interface Stockist {
  id: string;
  name: string;
  market: Market;
  city: string;
  currency: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactErased: boolean;
  notes: string;
  status: "active" | "archived";
  archivedAt: string | null;
  createdAt: string;
}

export interface Restock {
  id: string;
  weekday: string;
  copenhagenTime: string;
  pieces: Record<Market, number>;
  nextInstants: string[];
}

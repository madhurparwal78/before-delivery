// Shapes of the API's JSON bodies, as the brief publishes them.

import type { OfferedAction, Role, Status, PeakWindow, HourlyRate, RateStatus, ShelfRate } from "../shared/rules.js";
import type { DocumentType } from "../shared/format.js";

export interface SessionInfo {
  user: { id: string; name: string; email: string; role: Role; memberId: string | null };
  kitchen: { id: string; name: string; slug: string; timeZone: string };
}

export interface KitchenInfo {
  id: string; name: string; slug: string; timeZone: string; today: string; currentMonth: string;
  peakWindows: PeakWindow[]; requiredDocuments: DocumentType[]; rulesVersion: number;
}

export interface Booking {
  id: string; memberId: string; businessName: string; stationId: string; stationName: string; kind: "hourly" | "shelf";
  localDate: string; localStart: string | null; localEnd: string | null; days: number | null; start: string; end: string;
  status: Status; billingStatus: "not_billed" | "billed" | "pending_billing"; hours: number; peakHours: number;
  chargeCents: number; penaltyCents: number; penaltyWaived: boolean; conflict: boolean; seriesId: string | null;
  notes: string; holdExpiresAt: string | null; confirmedAt: string | null;
  /** The actions this caller may take at the response instant, in the brief's fixed order. */
  actions: OfferedAction[]; version: number;
}

/** Another member's block, as a member sees it. */
export interface BookedBlock {
  id: string; stationId: string; localDate: string; localStart: string | null; localEnd: string | null; days: number | null;
  start: string; end: string; status: "booked";
}

export type BoardBlock = Booking | BookedBlock;
export const isBooked = (b: BoardBlock): b is BookedBlock => b.status === "booked";

export interface HourBank { month: string; allowanceHours: number; usedHours: number; balanceHours: number }

export interface StationInfo { id: string; name: string; kind: "hourly" | "shelf"; capacity: number | null }
export type RateVersion = (HourlyRate | ShelfRate) & { status: RateStatus };
export interface Station extends StationInfo { currentRate: RateVersion | null; rates: RateVersion[] }

export interface OutOfService { id: string; stationId: string; start: string; end: string; localDate: string; localStart: string; localEnd: string; reason: string }

export interface Board {
  date: string; today: string; now: string; timeZone: string; stations: StationInfo[]; peakWindows: PeakWindow[];
  blocks: BoardBlock[]; outOfService: OutOfService[]; hourBank: HourBank | null;
}

export interface Member { id: string; name: string; businessName: string; email: string }

export interface DocumentRecord {
  id: string; memberId: string; businessName: string; type: DocumentType; expiryDate: string;
  status: "submitted" | "approved" | "expiring" | "expired" | "superseded"; current: boolean; fileName: string; contentType: string;
  sizeBytes: number; uploadedAt: string; approvedAt: string | null; version: number;
}

export interface InvoiceLine { kind: "booking" | "penalty" | "credit"; bookingId: string; description: string; amountCents: number; billingStatus: "billed" | "pending_billing" }
export interface Invoice { memberId: string; month: string; status: "open" | "closed"; lines: InvoiceLine[]; totalCents: number; hourBank: HourBank }

export interface UtilisationRow { stationId: string; name: string; bookedHours: number; peakHours: number; shelfDays: number; revenueCents: number }
export interface Utilisation { month: string; stations: UtilisationRow[]; totals: Omit<UtilisationRow, "stationId" | "name"> & { adjustmentCents: number } }

export interface SanitationEntry {
  id: string; area: string; task: string; sanitizerPpm: number | null; initials: string; notes: string;
  loggedAt: string; localDate: string; localTime: string; loggedBy: string;
}
export interface SanitationReport { month: string; status: "stored" | "queued"; storedAt?: string }

export interface AccessRecord { at: string; action: "view" | "document" | "report"; target: string | null }
export interface InspectorLink {
  id: string; email: string; expiresAt: string; status: "active" | "expired" | "revoked";
  lastAccessAt: string | null; views: number; downloads: number; access: AccessRecord[]; url?: string;
}

export interface ServiceStatus { billing: "up" | "down"; storage: "up" | "down"; queued: { billing: number; storage: number } }

export interface InspectorView {
  kitchen: { name: string; timeZone: string }; expiresAt: string; sanitationEntries: SanitationEntry[];
  sanitationReports: Array<{ month: string }>;
  certificates: Array<{ documentId: string; businessName: string; type: DocumentType; expiryDate: string; status: string }>;
}

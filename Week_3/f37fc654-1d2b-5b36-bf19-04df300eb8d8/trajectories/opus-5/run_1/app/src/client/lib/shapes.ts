import type { LayoutItem } from '../../shared/placement.js';
import type {
  AddOn,
  AppRole,
  Audience,
  DoorWall,
  InstallationType,
  PieceKind,
  SizeOption,
  Venue,
} from '../../shared/seed.js';
import type { CommissionState } from '../../shared/states.js';

/** The shapes the API answers with, as the screens read them. */

export interface QuoteShape {
  quoteId: string;
  lines: { label: string; amountCents: number }[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  issuedAt: string;
  validUntil: string;
}

export interface HoldShape {
  holdId: string;
  date: string;
  expiresAt: string;
  secondsRemaining: number;
  serverTime: string;
  status: 'held' | 'expired' | 'booked';
}

export interface InstallDayShape {
  id: string;
  date: string;
  startsAt: string;
  endsAt: string;
  venueName: string;
  crewUserIds: string[];
  confirmedAt: string | null;
}

export interface MilestoneShape {
  id: string;
  label: string;
  milestoneKey: string;
  scheduleBp: number;
  state: string;
  subtotalCents: number;
  taxCents: number;
  amountCents: number;
  invoicedAt: string | null;
  dueAt: string | null;
  killbillInvoiceId: string | null;
  killbillPaymentId: string | null;
  documentId: string | null;
}

export interface FunderShape {
  id: string;
  kind: 'client' | 'sponsor';
  name: string;
  email: string | null;
  bp: number;
  subtotalCents: number;
  taxCents: number;
  amountCents: number;
  state: string;
  inviteExpiresAt: string | null;
  position: number;
  dueAt: string | null;
  killbillInvoiceId: string | null;
  documentId: string | null;
}

export interface CommissionShape {
  id: string;
  title: string;
  state: CommissionState;
  installationType: InstallationType;
  venue: Venue;
  room: { widthM: number; depthM: number; doorWall: DoorWall };
  audience: Audience;
  notes: string;
  options: { size: SizeOption; addOns: AddOn[] };
  quote: QuoteShape | null;
  layout: { version: number; items: LayoutItem[] };
  requiredPieces: PieceKind[];
  hold: HoldShape | null;
  installDay: InstallDayShape | null;
  milestones: MilestoneShape[];
  funders: FunderShape[];
  clientId: string;
  createdAt: string;
}

export interface CommissionSummary {
  id: string;
  title: string;
  state: CommissionState;
  venueName: string;
  clientName: string;
  totalCents: number;
  paidCents: number;
  nextDueAt: string | null;
  nextDueCents: number | null;
  installDate: string | null;
}

export interface FileShape {
  id: string;
  kind: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  status: string;
  createdAt: string;
}

export interface RenderShape {
  id: string;
  commissionId: string;
  state: 'queued' | 'submitted' | 'callback_verified' | 'ready' | 'failed';
  progress: number;
  providerJobId: string | null;
  failureReason: string | null;
  previewSha256: string | null;
}

export interface DocumentShape {
  id: string;
  kind: 'contract' | 'invoice';
  version: number;
  label: string;
  status: 'preparing' | 'issued';
  sizeBytes: number | null;
  sha256: string | null;
  issuedAt: string | null;
}

export interface LedgerEntry {
  id: string;
  payerName: string;
  label: string;
  amountCents: number;
  killbillPaymentId: string;
  at: string;
}

export interface DeliveryShape {
  eventId: string;
  eventType: string;
  createdAt: string;
  attempts: { at: string; responseStatus: number; status: 'success' | 'failed' }[];
  finalState: string;
}

export interface JobShape {
  id: string;
  kind: string;
  commissionId: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface CrewDayShape {
  id: string;
  commissionId: string;
  commissionTitle: string;
  clientName: string;
  venue: Venue | null;
  date: string;
  startsAt: string;
  endsAt: string;
  crewUserIds: string[];
  layout: LayoutItem[];
  confirmedAt: string | null;
  alerts: { kind: string; title: string; sendAt: string; status: string }[];
}

export interface MaintenanceInvoice {
  killbillInvoiceId: string;
  amountCents: number;
  items: { description: string; amountCents: number; startDate: string | null; endDate: string | null }[];
}

export interface MaintenanceShape {
  plan: string | null;
  chargedThroughDate: string | null;
  invoices: MaintenanceInvoice[];
}

export interface ShareShape {
  commission: {
    title: string;
    venueName: string;
    installationType: string;
    installDate: string | null;
    studioName: string;
  };
  share: {
    id?: string;
    sponsorName: string;
    bp: number;
    subtotalCents: number;
    taxCents: number;
    amountCents: number;
    state?: string;
    dueAt?: string | null;
    killbillInvoiceId?: string | null;
    documentId?: string | null;
  };
  expiresAt?: string | null;
}

export interface VenueDayShape {
  date: string;
  status: 'free' | 'held' | 'booked' | 'unavailable' | 'yours';
  startsAt: string;
  endsAt: string;
}

export type { AppRole };

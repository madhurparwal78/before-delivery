/** Shared types for the client. */

export type Role = 'producer' | 'client' | 'sponsor' | 'crew';

export interface Me {
  id: string;
  email: string;
  name: string;
  roles: Role[];
}

export interface Venue {
  id: string;
  name: string;
  address: string;
  city: string;
  timeZone: string;
  taxRateBp: number;
}

export interface QuoteLine {
  label: string;
  amountCents: number;
}

export interface Quote {
  quoteId: string;
  lines: QuoteLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  issuedAt: string;
  validUntil: string;
}

export interface LayoutItem {
  kind: string;
  x: number;
  y: number;
  rotationDeg: number;
}

export interface PieceInfo {
  kind: string;
  label: string;
  widthM: number;
  depthM: number;
}

export interface Milestone {
  id: string;
  label: string;
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

export interface Funder {
  id: string;
  kind: 'client' | 'sponsor';
  name: string | null;
  email: string | null;
  bp: number;
  subtotalCents: number | null;
  taxCents: number | null;
  amountCents: number | null;
  state: string;
  inviteExpiresAt: string | null;
  position: number;
}

export interface Hold {
  holdId: string;
  date: string;
  expiresAt: string;
  secondsRemaining: number;
  serverTime: string;
  status: 'held' | 'expired' | 'booked';
}

export interface InstallDay {
  id: string;
  date: string;
  startsAt: string;
  endsAt: string;
  crewUserIds: string[];
}

export interface Commission {
  id: string;
  title: string;
  state: string;
  installationType: string;
  venue: Venue;
  room: { widthM: number; depthM: number; doorWall: 'front' | 'back' | 'left' | 'right' };
  audience: string;
  notes: string | null;
  options: { size: 'compact' | 'standard' | 'grand'; addOns: string[] };
  quote: Quote | null;
  layout: { version: number; items: LayoutItem[] };
  requiredPieces: PieceInfo[];
  hold: Hold | null;
  installDay: InstallDay | null;
  milestones: Milestone[];
  funders: Funder[];
  clientId: string;
  clientName: string;
  createdAt: string;
}

export interface CommissionListEntry {
  id: string;
  title: string;
  state: string;
  venueName: string;
  clientName: string;
  totalCents: number;
  paidCents: number;
  nextDueAt: string | null;
  nextDueCents: number | null;
  installDate: string | null;
}

export interface BriefShape {
  id: string;
  answers: Record<string, unknown>;
  answeredThrough: number;
  nextStep: number | null;
  commissionId: string | null;
}

export interface CommissionFile {
  id: string;
  kind: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  status: string;
  createdAt: string;
}

export interface Render {
  id: string;
  state: string;
  progress: number;
  providerJobId: string | null;
  failureReason: string | null;
  previewSha256: string | null;
}

export interface LedgerEntry {
  id: string;
  payerName: string;
  label: string;
  amountCents: number;
  killbillPaymentId: string;
  at: string;
}

export interface DocumentEntry {
  id: string;
  kind: 'contract' | 'invoice';
  version: number;
  label: string;
  status: 'preparing' | 'issued';
  sizeBytes: number | null;
  sha256: string | null;
  issuedAt: string | null;
}

export interface Job {
  id: string;
  kind: string;
  commissionId: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface CrmDelivery {
  eventId: string;
  eventType: string;
  createdAt: string;
  finalState: string;
  attempts: Array<{ at: string; responseStatus: number; status: string }>;
}

export interface InstallDayDetail {
  id: string;
  commissionId: string;
  commissionTitle: string;
  clientName: string;
  venue: Venue;
  date: string;
  startsAt: string;
  endsAt: string;
  crewUserIds: string[];
  layout: { items: LayoutItem[] };
  alerts: Array<{ kind: string; title: string; sendAt: string; status: string }>;
}

export interface ShareInfo {
  commission: { title: string; venueName: string; installationType: string; installDate: string | null };
  share: {
    funderId?: string;
    sponsorName: string | null;
    bp: number;
    subtotalCents: number | null;
    taxCents: number | null;
    amountCents: number | null;
    state?: string;
    dueAt?: string | null;
    killbillInvoiceId?: string | null;
    documentId?: string | null;
  };
}

export interface ServiceStatus {
  postgres: string;
  keycloak: string;
  killbill: string;
  mailpit: string;
  minio: string;
  gotenberg: string;
  svix: string;
  ntfy: string;
  renderProvider: string;
}

export interface ApiErrorBody {
  error: { code: string; message?: string; [k: string]: unknown };
}

export const OUTAGE_BANNERS: Record<string, string> = {
  killbill: 'Payments are paused — our billing system isn\'t answering. Nothing has been charged.',
  mailpit: 'Emails are delayed — receipts and notices will arrive once our mail service is back.',
  minio: 'Uploads are paused — our file store isn\'t answering. Nothing was saved.',
  gotenberg: 'Documents are delayed — PDFs will appear here once our document service is back.',
  svix: 'CRM updates are delayed — they\'ll be sent once our webhook service is back.',
  ntfy: 'Crew alerts are delayed — they\'ll be posted once our alert service is back.',
  renderProvider: 'Concept previews are delayed — requests are queued and will start once our render partner is back.',
  keycloak: 'Sign-in is paused — our sign-in service isn\'t answering. If you\'re already signed in, you can keep working for now.',
  postgres: 'The studio is offline — we can\'t reach our records. Try again in a minute.',
};

export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const centsPart = String(abs % 100).padStart(2, '0');
  return `${sign}$${String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${centsPart}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[t.getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

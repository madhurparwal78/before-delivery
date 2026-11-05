import type { Currency } from "./money";

export type PlanId = "launch-page" | "studio-site" | "care-lite" | "care-plus";
export type Tier = "lite" | "plus";
export type OrderState = "quoted" | "accepted" | "deposit_paid" | "in_build" | "balance_invoiced" | "paid_in_full" | "closed";
export type Role = "client_owner" | "teammate" | "studio_owner" | "contractor";
export type PlanStatus = "active" | "paused" | "pending_cancel" | "past_due" | "cancelled";
export type PaymentKind = "deposit" | "balance" | "care";
export type InvoiceKind = "deposit" | "balance" | "care" | "renewal" | "change";
export type InvoiceStatus = "paid" | "open" | "void" | "credit";
export type FileKind = "asset" | "deliverable";
export type EntryKind = "case_study" | "journal";
export type EntryStatus = "draft" | "published" | "withdrawn";

export const PLAN_IDS: readonly PlanId[] = ["launch-page", "studio-site", "care-lite", "care-plus"];
export const PLAN_NAMES: Record<PlanId, string> = {
  "launch-page": "Launch Page",
  "studio-site": "Studio Site",
  "care-lite": "Care Lite",
  "care-plus": "Care Plus",
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

export function isCare(plan: PlanId): plan is "care-lite" | "care-plus" {
  return plan === "care-lite" || plan === "care-plus";
}

export function careTier(plan: "care-lite" | "care-plus"): Tier {
  return plan === "care-lite" ? "lite" : "plus";
}

export function carePlan(tier: Tier): "care-lite" | "care-plus" {
  return tier === "lite" ? "care-lite" : "care-plus";
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  accountId: string | null;
}

export interface Quote {
  plan: PlanId;
  currency: Currency;
  total: string;
  dueNow: string;
  dueAtLaunch: string;
  dueNowShare: string;
  priceEffectiveAt: string;
}

export interface OrderPayment {
  kind: PaymentKind;
  amount: string;
  refunded: string;
  remaining: string;
  capturedAt: string;
  killbillPaymentId: string;
}

export interface Order {
  id: string;
  number: string;
  accountId: string | null;
  plan: PlanId;
  planName: string;
  currency: Currency;
  state: OrderState;
  total: string;
  dueNow: string;
  dueAtLaunch: string;
  acceptedAt: string | null;
  projectId: string | null;
  payments: OrderPayment[];
  businessName?: string | null;
}

export interface Plan {
  id: string;
  tier: Tier;
  planName: string;
  status: PlanStatus;
  currency: Currency;
  monthlyPrice: string;
  periodStart: string | null;
  chargedThrough: string | null;
  pauseOn: string | null;
  endsOn: string | null;
  failedAttempts: number;
  nextRetryAt: string | null;
}

export interface Preview {
  previewId: string;
  fromTier: Tier;
  toTier: Tier;
  currency: Currency;
  credit: string;
  charge: string;
  total: string;
  creditShare: string;
  daysLeft: number;
  daysInPeriod: number;
  expiresAt: string;
}

export interface Invoice {
  id: string;
  number: string;
  date: string;
  kind: InvoiceKind;
  description: string;
  amount: string;
  balance: string;
  currency: Currency;
  status: InvoiceStatus;
  orderId: string | null;
  pdf: boolean;
}

export interface FileRecord {
  id: string;
  kind: FileKind;
  name: string;
  type: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface ProjectSummary {
  id: string;
  orderNumber: string;
  businessName: string;
  planName: string;
  state: OrderState;
  closedAt: string | null;
}

export interface Contractor {
  id: string;
  name: string;
  email: string;
}

export interface Project extends ProjectSummary {
  orderId: string;
  assets: FileRecord[];
  deliverables: FileRecord[];
  contractors: Contractor[];
}

export interface EntrySummary {
  slug: string;
  title: string;
  client: string | null;
  year: number | null;
  summary: string;
  publishedAt: string;
}

export interface Entry extends EntrySummary {
  body: string;
}

export interface StudioEntry {
  id: string;
  kind: EntryKind;
  slug: string;
  title: string;
  client: string | null;
  year: number | null;
  summary: string;
  status: EntryStatus;
  publishedAt: string | null;
}

export interface PriceRow {
  id: string;
  plan: PlanId;
  currency: Currency;
  amount: string;
  effectiveAt: string;
}

export interface ApiError {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `2026-12-01` → `1 December 2026`. */
export function longDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

import type { CurrencyCode } from './money';

export type { CurrencyCode };

export type EngagementState =
  | 'quoted'
  | 'deposit_paid'
  | 'look_dev_review'
  | 'revision_requested'
  | 'final_review'
  | 'delivered'
  | 'cancelled_with_refund';

export type Milestone = 'deposit' | 'look_dev' | 'final_delivery';
export type FileKind = 'model' | 'step' | 'reference';
export type MeasurementStatus = 'pending' | 'delayed' | 'measured' | 'failed';
export type ExportUnit = 'as_exported' | 'mm' | 'cm' | 'in';
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'payment_failed' | 'overdue' | 'void';

export interface QuoteLine {
  shot_code: string;
  title: string;
  quantity: number;
  unit_price_gbp_minor: number;
  amount_minor: number;
}

export interface Quote {
  currency: CurrencyCode;
  exponent: number;
  revision: number;
  fx_rate: string;
  fx_locked: boolean;
  fx_locked_at: string | null;
  lines: QuoteLine[];
  subtotal_minor: number;
  vat_minor: number;
  total_minor: number;
  milestones: {
    deposit_minor: number;
    look_dev_minor: number;
    final_delivery_minor: number;
  };
}

export interface IntakeFile {
  id: string;
  name: string;
  kind: FileKind;
  size_bytes: number;
  status: 'received' | 'superseded';
  measurement: MeasurementStatus | null;
  needs_unit_confirmation: boolean;
  unit: ExportUnit | null;
  dimensions_m: { x: number; y: number; z: number } | null;
  dimensions_mm: { x: number; y: number; z: number } | null;
}

export interface InvoiceLine {
  description: string;
  amount_minor: number;
}

export interface Invoice {
  id: string;
  engagement_id: string;
  milestone: Milestone;
  number: string | null;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  amount_minor: number;
  balance_minor: number;
  currency: CurrencyCode;
  killbill_invoice_id: string | null;
  failed_attempts: number;
  issued_at: string | null;
  overdue_at: string | null;
}

export interface LedgerEntry {
  id: string;
  kind: 'deposit' | 'invoice_payment' | 'refund';
  amount_minor: number;
  currency: CurrencyCode;
  invoice_id: string | null;
  killbill_payment_id: string;
  created_at: string;
}

export interface EngagementBrand {
  id: string;
  name: string;
  currency: CurrencyCode;
}

export interface Engagement {
  id: string;
  reference: string;
  title: string;
  state: EngagementState;
  brand: EngagementBrand;
  quote: Quote;
  files: IntakeFile[];
  invoices: Invoice[];
  ledger: LedgerEntry[];
  revision_rounds: { look_dev: number; final_delivery: number };
}

export interface ReviewStill {
  id: string;
  shot_code: string;
  title: string;
  url: string;
}

export interface Review {
  reference: string;
  brand_name: string;
  milestone: Milestone;
  state: EngagementState;
  revision_rounds_used: number;
  revision_rounds_included: number;
  actions_open: boolean;
  stills: ReviewStill[];
}

export interface CaseStudyScene {
  primitives: string[];
  accent: string;
}

export interface CaseStudy {
  slug: string;
  title: string;
  client: string;
  summary: string;
  scene: CaseStudyScene;
  published: boolean;
  sort: number;
}

export interface ServiceRecord {
  code: string;
  title: string;
  list_price_pence: number;
  azimuth_deg: number;
  elevation_deg: number;
  sort: number;
}

export interface RateRecord {
  currency: 'EUR' | 'USD' | 'JPY';
  rate: string;
  effective_at: string;
}

export interface TestCard {
  number: string;
  expiry: string;
  cvc: string;
  name: string;
}

export const APPROVING_CARD = '4242424242424242';
export const DECLINING_CARD = '4000000000000002';

export const MILESTONE_LABELS: Record<Milestone, string> = {
  deposit: 'Deposit',
  look_dev: 'Look-dev',
  final_delivery: 'Final delivery',
};

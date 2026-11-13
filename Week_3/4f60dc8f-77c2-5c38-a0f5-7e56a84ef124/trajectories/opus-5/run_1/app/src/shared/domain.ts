import type { CurrencyCode } from './money.js';

export const SHOT_ORDER = [
  'hero_front',
  'three_quarter',
  'top_down',
  'detail_macro',
  'turntable_360',
  'exploded_view',
] as const;

export type ShotCode = (typeof SHOT_ORDER)[number];

export const isShotCode = (value: unknown): value is ShotCode =>
  typeof value === 'string' && (SHOT_ORDER as readonly string[]).includes(value);

export const shotSortIndex = (code: string): number => {
  const index = (SHOT_ORDER as readonly string[]).indexOf(code);
  return index === -1 ? SHOT_ORDER.length : index;
};

export const MILESTONES = ['deposit', 'look_dev', 'final_delivery'] as const;
export type Milestone = (typeof MILESTONES)[number];
export type ReviewMilestone = Extract<Milestone, 'look_dev' | 'final_delivery'>;

export const MILESTONE_LABEL: Record<Milestone, string> = {
  deposit: 'Deposit',
  look_dev: 'Look-dev',
  final_delivery: 'Final delivery',
};

export const milestoneSortIndex = (milestone: Milestone): number =>
  MILESTONES.indexOf(milestone);

export const ENGAGEMENT_STATES = [
  'quoted',
  'deposit_paid',
  'look_dev_review',
  'revision_requested',
  'final_review',
  'delivered',
  'cancelled_with_refund',
] as const;
export type EngagementState = (typeof ENGAGEMENT_STATES)[number];

export const INVOICE_STATUSES = [
  'draft',
  'issued',
  'paid',
  'payment_failed',
  'overdue',
  'void',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_WORD: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  paid: 'Paid',
  payment_failed: 'Payment failed',
  overdue: 'Overdue',
  void: 'Void',
};

export type IntakeKind = 'model' | 'step' | 'reference';
export type IntakeStatus = 'received' | 'superseded';
export type MeasurementState = 'pending' | 'delayed' | 'measured' | 'failed';
export type UnitDecision = 'as_exported' | 'mm' | 'cm' | 'in';

export const UNIT_SCALE: Record<UnitDecision, number> = {
  as_exported: 1,
  mm: 0.001,
  cm: 0.01,
  in: 0.0254,
};

export const UNIT_DECISIONS = ['as_exported', 'mm', 'cm', 'in'] as const;

export const isUnitDecision = (value: unknown): value is UnitDecision =>
  typeof value === 'string' && (UNIT_DECISIONS as readonly string[]).includes(value);

export const UNIT_LABEL: Record<UnitDecision, string> = {
  as_exported: 'As exported (metres)',
  mm: 'Millimetres',
  cm: 'Centimetres',
  in: 'Inches',
};

/** A largest dimension above this, or below the minimum, needs a unit decision. */
export const RANGE_MAX_METRES = 5;
export const RANGE_MIN_METRES = 0.005;

export const SCENE_PRIMITIVES = ['box', 'cylinder', 'sphere', 'torus', 'capsule'] as const;
export type ScenePrimitive = (typeof SCENE_PRIMITIVES)[number];
export const SCENE_ACCENTS = ['ember', 'cobalt', 'violet'] as const;
export type SceneAccent = (typeof SCENE_ACCENTS)[number];

export type SceneSpec = { primitives: ScenePrimitive[]; accent: SceneAccent };

export type CaseStudy = {
  slug: string;
  title: string;
  client: string;
  summary: string;
  scene: SceneSpec;
  published: boolean;
  sort: number;
};

export type Service = {
  code: string;
  title: string;
  list_price_pence: number;
  azimuth_deg: number;
  elevation_deg: number;
  sort: number;
};

export type TeamMember = { name: string; role: string; bio: string };
export type Insight = { slug: string; title: string; summary: string };

export type StudioContent = {
  case_studies: CaseStudy[];
  services: Service[];
  team: TeamMember[];
  insights: Insight[];
  marquee: string[];
};

export type QuoteLineView = {
  shot_code: string;
  title: string;
  quantity: number;
  unit_price_gbp_minor: number;
  amount_minor: number;
};

export type QuoteView = {
  currency: CurrencyCode;
  exponent: number;
  revision: number;
  fx_rate: string;
  fx_locked: boolean;
  fx_locked_at: string | null;
  lines: QuoteLineView[];
  subtotal_minor: number;
  vat_minor: number;
  total_minor: number;
  milestones: {
    deposit_minor: number;
    look_dev_minor: number;
    final_delivery_minor: number;
  };
};

export type IntakeFileView = {
  id: string;
  name: string;
  kind: IntakeKind;
  size_bytes: number;
  status: IntakeStatus;
  measurement: MeasurementState | null;
  needs_unit_confirmation: boolean;
  unit: UnitDecision | null;
  dimensions_m: { x: number; y: number; z: number } | null;
  dimensions_mm: { x: number; y: number; z: number } | null;
};

export type InvoiceLineView = { description: string; amount_minor: number };

export type InvoiceView = {
  id: string;
  engagement_id: string;
  milestone: Milestone;
  number: string | null;
  status: InvoiceStatus;
  lines: InvoiceLineView[];
  amount_minor: number;
  balance_minor: number;
  currency: CurrencyCode;
  killbill_invoice_id: string | null;
  failed_attempts: number;
  issued_at: string | null;
  overdue_at: string | null;
};

export type LedgerEntryView = {
  id: string;
  kind: 'deposit' | 'invoice_payment' | 'refund';
  amount_minor: number;
  currency: CurrencyCode;
  invoice_id: string | null;
  killbill_payment_id: string;
  created_at: string;
};

export type EngagementView = {
  id: string;
  reference: string;
  title: string;
  state: EngagementState;
  brand: { id: string; name: string; currency: CurrencyCode };
  quote: QuoteView;
  files: IntakeFileView[];
  invoices: InvoiceView[];
  ledger: LedgerEntryView[];
  revision_rounds: { look_dev: number; final_delivery: number };
};

export type StudioEngagementView = EngagementView & {
  stills: { id: string; shot_code: string; milestone: ReviewMilestone }[];
  review_link: { expires_at: string } | null;
};

export type ReviewStill = { id: string; shot_code: string; title: string; url: string };

export type ReviewView = {
  reference: string;
  brand_name: string;
  milestone: ReviewMilestone;
  state: EngagementState;
  revision_rounds_used: number;
  revision_rounds_included: 2;
  actions_open: boolean;
  stills: ReviewStill[];
};

export type StatusView = {
  billing: 'up' | 'down';
  storage: 'up' | 'down';
  email: 'up' | 'down';
  measuring: 'up' | 'down';
  documents: 'up' | 'down';
};

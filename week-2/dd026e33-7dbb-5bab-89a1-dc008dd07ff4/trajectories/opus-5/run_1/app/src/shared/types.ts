import type { Band, CoatStack } from './coatstack';
import type { PanelId } from './panels';
import type { UnitSettings } from './units';

export type Role = 'concierge' | 'care_technician' | 'workshop_lead' | 'house_manager' | 'owner';

export const STAFF_ROLES: readonly Role[] = [
  'concierge',
  'care_technician',
  'workshop_lead',
  'house_manager',
];

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Actor {
  id: string;
  name: string;
}

export type BayClass = 'standard' | 'covered_lift' | 'sealed_capsule';

export const BAY_CLASS_LABEL: Record<BayClass, string> = {
  standard: 'Standard',
  covered_lift: 'Covered lift',
  sealed_capsule: 'Sealed capsule',
};

export type CarStatus = 'awaiting_intake' | 'stored' | 'released';
export type StartupStatus = 'ok' | 'overdue' | 'not_scheduled';
export type BayBillingStatus = 'none' | 'pending' | 'active' | 'ending';

export interface Startup {
  scheduled: boolean;
  last_at: string | null;
  next_due: string | null;
  status: StartupStatus;
}

export interface BayBilling {
  status: BayBillingStatus;
  plan: string | null;
  monthly_price: string | null;
  charged_through_date: string | null;
  billing_end_date: string | null;
  cancel_requested: boolean;
}

export interface CarBay {
  id: string;
  code: string;
  class: BayClass;
}

export interface Car {
  id: string;
  name: string;
  year: number;
  make: string;
  model: string;
  registration: string;
  colour: string;
  owner: Actor;
  length_mm: number;
  width_mm: number;
  odometer_km: number;
  tyre_spec_bar: string;
  status: CarStatus;
  bay: CarBay | null;
  startup: Startup;
  bay_billing: BayBilling;
  open_release: boolean;
}

export type ItemKind = 'key_set' | 'cover' | 'spare_wheel' | 'document';

export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  key_set: 'Key set',
  cover: 'Cover',
  spare_wheel: 'Spare wheel',
  document: 'Document',
};

export interface Item {
  id: string;
  kind: ItemKind;
  label: string;
  count_in: number;
}

export interface Movement {
  id: string;
  direction: 'in' | 'out';
  count: number;
  at: string;
  by: Actor;
}

export interface Report {
  id: string;
  car_id: string;
  sha256: string;
  size_bytes: number;
  uploaded_at: string;
  uploaded_by: Actor;
}

export interface Photo {
  id: string;
  car_id: string;
  kind: 'intake' | 'stage';
  job_id: string | null;
  content_type: string;
  size_bytes: number;
  attached: true;
  created_at: string;
}

export type CareFlag = 'battery_low' | 'tyre_pressure';

export const CARE_FLAG_LABEL: Record<CareFlag, string> = {
  battery_low: 'battery low',
  tyre_pressure: 'tyre pressure off',
};

export interface Entry {
  id: string;
  at: string;
  by: Actor;
  started: boolean;
  battery_v: string | null;
  tyres_bar: { fl: string; fr: string; rl: string; rr: string } | null;
  note: string;
  flags: CareFlag[];
}

export type LineKind = 'part' | 'labour' | 'paint_materials';

export const LINE_KIND_LABEL: Record<LineKind, string> = {
  part: 'Part',
  labour: 'Labour',
  paint_materials: 'Paint materials',
};

export interface Line {
  id: string;
  kind: LineKind;
  description: string;
  quantity: string;
  unit_price: string;
  net: string;
  vat: string;
}

export type JobStatus =
  | 'draft'
  | 'sent'
  | 'approved'
  | 'declined'
  | 'expired'
  | 'in_progress'
  | 'finished'
  | 'invoiced'
  | 'paid';

export interface JobStage {
  id: string;
  index: number;
  name: string;
  logged_at: string;
  readings_count: number;
}

export interface Job {
  id: string;
  number: string;
  version: number;
  car: Actor;
  owner: Actor;
  title: string;
  status: JobStatus;
  lines: Line[];
  net_total: string;
  vat_total: string;
  rounding: string;
  total: string;
  currency: 'CHF';
  sent_at: string | null;
  expires_at: string | null;
  approved_at: string | null;
  declined_at: string | null;
  finished_at: string | null;
  stages: JobStage[];
  invoice_id: string | null;
}

export interface Payment {
  killbill_payment_id?: string;
  amount: string;
  refunded: string;
  reference: string | null;
  at: string;
  recorded_by?: Actor | null;
}

export interface Invoice {
  id: string;
  number: string;
  job_id: string;
  car: Actor;
  owner: Actor;
  lines: Line[];
  net_total: string;
  vat_total: string;
  rounding: string;
  total: string;
  currency: 'CHF';
  balance: string;
  balance_live: boolean;
  status: 'awaiting_payment' | 'paid';
  issued_at: string;
  paid_at: string | null;
  status_confirmed_at: string;
  payments: Payment[];
  killbill_invoice_id?: string;
}

export type ReleaseStatus = 'requested' | 'booked' | 'staged' | 'released' | 'cancelled';

export interface ReleaseEvent {
  status: ReleaseStatus;
  at: string;
  by: Actor;
}

export interface HoldingInvoice {
  id: string;
  number: string;
  balance: string;
}

export interface Release {
  id: string;
  car: Actor;
  owner: Actor;
  slot: string;
  slot_label: string;
  status: ReleaseStatus;
  bay_code: string | null;
  held_by: HoldingInvoice[];
  events: ReleaseEvent[];
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  revoked_at: string | null;
  last_sign_in_at: string | null;
}

export interface Bay {
  id: string;
  code: string;
  class: BayClass;
  length_mm: number;
  width_mm: number;
  row: number;
  column: number;
  car: Actor | null;
  eligible?: boolean;
  reason?: 'occupied' | 'too_small' | 'class_change' | null;
}

export interface CarDetail extends Car {
  belongings: Item[];
  condition_report: Report | null;
  photos: Photo[];
  care_entries: Entry[];
  jobs: { id: string; number: string; title: string; status: JobStatus }[];
  releases: Release[];
}

export interface CareRoundCar {
  car: Actor;
  bay_code: string;
  startup: Startup;
  last_entry: Entry | null;
}

export interface HouseSettings {
  name: string;
  time_zone: 'Europe/Zurich';
  currency: 'CHF';
  vat_rate: string;
  labour_rate: string;
  clearance_mm: number;
}

export interface MeResponse {
  user: User;
  units: UnitSettings;
}

export interface ServiceStatus {
  storage: 'up' | 'down';
  billing: 'up' | 'down';
  mail: 'up' | 'down';
}

export interface BoardResponse {
  occupancy: { occupied: number; total: number };
  bays: Bay[];
  overdue: { car: Actor; bay_code: string; startup: Startup }[];
  unpaid: { invoices: Invoice[]; total: string; live: boolean };
}

export interface PanelReadingsResponse {
  panel: PanelId;
  readings: {
    id: string;
    stage: string;
    film_um: number;
    logged_at: string;
    logged_by: Actor;
  }[];
}

export type { Band, CoatStack, PanelId, UnitSettings };

export interface ApiErrorBody {
  error?: string;
  errors?: Record<string, string>;
  items?: Item[];
  invoices?: HoldingInvoice[];
}
